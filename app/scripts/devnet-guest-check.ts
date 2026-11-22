import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { type AccountFeed, type FeedStatus, createAccountFeed } from "../src/lib/chain/account-feed";
import { type SeatSnapshot, type TableSnapshot, fetchSeat, fetchTable, watchSeat, watchTable } from "../src/lib/chain/accounts";
import { findSeatAddress, findWalletTokenAddress } from "../src/lib/chain/addresses";
import { createChainClient, createSponsoredFeePayment, fetchSponsorStatus } from "../src/lib/chain/client";
import { ROLLUP_RPC_URL, ROLLUP_WS_URL, SPONSOR_REQUEST_TIMEOUT_MS, SPONSOR_ROUTE_PATH } from "../src/lib/chain/config";
import { createDepositChain, createDepositQueue } from "../src/lib/chain/deposits";
import { loadGuestKey } from "../src/lib/chain/guest-key";
import { type KeyStore, createMemoryKeyStore } from "../src/lib/chain/key-store";
import { claimTestUsdc, createSeatActions, sitAtTable } from "../src/lib/chain/player";
import { type Result, attempt, attemptSync, failure, pollUntil, success } from "../src/lib/chain/result";
import { fetchWithTimeout } from "../src/lib/chain/rpc";
import { createSessionKeeper } from "../src/lib/chain/session";
import { type RollupAck, createKeypairSigner, readTokenUnits } from "../src/lib/chain/transport";

const DEFAULT_ROUTE_URL = `http://localhost:3001${SPONSOR_ROUTE_PATH}`;
const DEFAULT_TABLE = "BmwZZovvZBLLL6WTAAEAFA4Xe1RHqs2iawav9EaE5aQk";
const DEPOSIT_UNITS = 1_000_000n;
const BUY_IN_CHIPS = 100n;
const PROPAGATION_TIMEOUT_MS = 60_000;
const UPDATE_TIMEOUT_MS = 15_000;
const POLL_MS = 100;
const UNREACHABLE_WS_URL = "ws://127.0.0.1:9";

type Observed<Snapshot> = { snapshot: Snapshot; receivedAtMs: number };

const log = (message: string): void => console.log(`[devnetGuestCheck] ${message}`);

const createFileKeyStore = (path: string): KeyStore => {
  const readAll = (): Record<string, string> => {
    if (!existsSync(path)) return {};
    const parsed = attemptSync((): unknown => JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) return {};
    return Object.fromEntries(Object.entries(parsed.value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  };
  const writeAll = (values: Record<string, string>) => writeFileSync(path, JSON.stringify(values), { mode: 0o600 });
  return {
    isDurable: true,
    read: (key) => readAll()[key] ?? null,
    write: (key, value) => attemptSync(() => writeAll({ ...readAll(), [key]: value })).ok,
    remove: (key) => attemptSync(() => writeAll(Object.fromEntries(Object.entries(readAll()).filter(([storedKey]) => storedKey !== key)))).ok,
    listKeys: (prefix) => Object.keys(readAll()).filter((key) => key.startsWith(prefix)),
  };
};

const roundMs = (value: number): number => Math.round(value * 10) / 10;

const requireAck = (label: string, ack: RollupAck): Result<number> =>
  ack.ok ? success(roundMs(ack.ackMs)) : failure(`[requireAck] ${label}: ${ack.errorName} ${ack.detail}`);

const observeFeed = <Snapshot>(
  feed: AccountFeed,
  watch: (feed: AccountFeed, listener: { onSnapshot: (snapshot: Snapshot) => void; onError: (reason: string) => void }) => () => void,
) => {
  const seen: Observed<Snapshot>[] = [];
  const stop = watch(feed, {
    onSnapshot: (snapshot) => seen.push({ snapshot, receivedAtMs: performance.now() }),
    onError: (reason) => log(`decode error: ${reason}`),
  });
  const waitFor = (label: string, isWanted: (snapshot: Snapshot) => boolean, afterMs: number) =>
    pollUntil(label, async () => seen.find((entry) => entry.receivedAtMs >= afterMs && isWanted(entry.snapshot)) ?? null, UPDATE_TIMEOUT_MS, 10);
  return { seen, stop, waitFor };
};

const checkRefusal = async (routeUrl: string, sponsor: PublicKey): Promise<Result<string>> => {
  const drain = new Transaction({ feePayer: sponsor, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(
    SystemProgram.transfer({ fromPubkey: sponsor, toPubkey: Keypair.generate().publicKey, lamports: 100_000_000 }),
  );
  const serialized = attemptSync(() => drain.serialize({ requireAllSignatures: false, verifySignatures: false }));
  if (!serialized.ok) return serialized;
  const encoded = Buffer.from(serialized.value).toString("base64");
  const response = await attempt(() =>
    fetchWithTimeout(routeUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transaction: encoded }) }, SPONSOR_REQUEST_TIMEOUT_MS),
  );
  if (!response.ok) return response;
  const body = await response.value.text();
  return response.value.status === 400 ? success(body) : failure(`[checkRefusal] expected 400, got ${response.value.status}: ${body}`);
};

const runGuestCheck = async (
  routeUrl: string,
  tableAddress: PublicKey,
  keyFilePath: string | undefined,
): Promise<Result<Record<string, unknown>>> => {
  const feePayment = await createSponsoredFeePayment(routeUrl);
  if (!feePayment.ok || feePayment.value.kind !== "sponsor") return failure(feePayment.ok ? "[runGuestCheck] not sponsored" : feePayment.reason);
  const sponsor = feePayment.value.sponsor;
  const client = createChainClient(feePayment.value);
  const sponsorLamportsBefore = await client.base.getBalance(sponsor, "confirmed");
  const refusal = await checkRefusal(routeUrl, sponsor);
  if (!refusal.ok) return refusal;
  log(`a transfer out of the sponsor is refused: ${refusal.value}`);

  const store = keyFilePath === undefined ? createMemoryKeyStore() : createFileKeyStore(keyFilePath);
  const guest = loadGuestKey(store);
  const wallet = createKeypairSigner(guest.keypair);
  log(`fresh guest ${guest.keypair.publicKey.toBase58()}, sponsor ${sponsor.toBase58()}`);
  if (!guest.isPersisted) log("the guest key is not persisted, a rerun without a key file starts a new wallet");
  const table = await fetchTable(client.programs.sandwich, client.rollup, tableAddress);
  if (!table.ok || table.value === null) return failure(`[runGuestCheck] table: ${table.ok ? "missing" : table.reason}`);
  const mint = table.value.mint;
  const validator = table.value.validator;

  const setupStartedAt = performance.now();
  const sessions = createSessionKeeper(client, wallet, store);
  const [seated, funded, session] = await Promise.all([
    sitAtTable(client, wallet, tableAddress),
    claimTestUsdc(client, wallet),
    sessions.resolve(),
  ]);
  if (!seated.ok) return seated;
  if (!funded.ok) return funded;
  if (!session.ok) return session;
  const baseSetupMs = performance.now() - setupStartedAt;
  const baseUnits = await readTokenUnits(client.base, findWalletTokenAddress(guest.keypair.publicKey, mint));
  log(`sit ${seated.value.signature} (${roundMs(seated.value.confirmMs)} ms), faucet ${funded.value.signature} (${roundMs(funded.value.confirmMs)} ms), session ${session.value.signature} (${roundMs(baseSetupMs)} ms for all three)`);

  const seatAddress = findSeatAddress(tableAddress, guest.keypair.publicKey);
  const delegationStartedAt = performance.now();
  const seatVisible = await pollUntil(
    "seat on the rollup",
    async () => {
      const seat = await fetchSeat(client.programs.sandwich, client.rollup, seatAddress);
      return seat.ok ? seat.value : null;
    },
    PROPAGATION_TIMEOUT_MS,
    POLL_MS,
  );
  if (!seatVisible.ok) return seatVisible;
  const seatVisibleMs = performance.now() - delegationStartedAt;

  const liveStatuses: FeedStatus[] = [];
  const pollingStatuses: FeedStatus[] = [];
  const liveFeed = createAccountFeed({ rpcUrl: ROLLUP_RPC_URL, wsUrl: ROLLUP_WS_URL, onStatus: (status) => liveStatuses.push(status) });
  const pollingFeed = createAccountFeed({ rpcUrl: ROLLUP_RPC_URL, wsUrl: UNREACHABLE_WS_URL, onStatus: (status) => pollingStatuses.push(status) });
  const liveTable = observeFeed<TableSnapshot>(liveFeed, (feed, listener) => watchTable(feed, client.programs.sandwich, tableAddress, listener));
  const liveSeat = observeFeed<SeatSnapshot>(liveFeed, (feed, listener) => watchSeat(feed, client.programs.sandwich, seatAddress, listener));
  const pollingSeat = observeFeed<SeatSnapshot>(pollingFeed, (feed, listener) => watchSeat(feed, client.programs.sandwich, seatAddress, listener));
  const feedLive = await pollUntil("live feed", async () => (liveFeed.status() === "live" && liveTable.seen.length > 0 ? true : null), UPDATE_TIMEOUT_MS, 10);
  if (!feedLive.ok) return feedLive;

  const actions = createSeatActions({ client, table: tableAddress, mint, wallet, sessions });
  const isGuest = (key: PublicKey | null) => key?.equals(guest.keypair.publicKey) === true;
  const joinSentAt = performance.now();
  const joinAck = requireAck("join", await actions.join());
  if (!joinAck.ok) return joinAck;
  const joinedTable = await liveTable.waitFor("table update after join", (snapshot) => snapshot.seats.some(isGuest), joinSentAt);
  if (!joinedTable.ok) return joinedTable;
  const joinedSeat = await liveSeat.waitFor("seat update after join", (snapshot) => snapshot.seatIndex !== null, joinSentAt);
  if (!joinedSeat.ok) return joinedSeat;
  log(`join acknowledged in ${joinAck.value} ms, table update ${roundMs(joinedTable.value.receivedAtMs - joinSentAt)} ms after send, guest at place ${joinedSeat.value.snapshot.seatIndex}`);

  const deposits = createDepositQueue({ chain: createDepositChain({ client, owner: wallet, mint, validator }), owner: wallet.publicKey, store });
  const runMoneyLeg = async () => {
    const deposited = await deposits.deposit(DEPOSIT_UNITS);
    if (!deposited.ok) return deposited;
    log(`deposit ${deposited.value.state}: ${deposited.value.signature}`);
    const buyInSentAt = performance.now();
    const buyInAck = requireAck("buy_in", await actions.buyIn(BUY_IN_CHIPS));
    if (!buyInAck.ok) return buyInAck;
    const boughtIn = await liveSeat.waitFor("seat update after buy_in", (snapshot) => snapshot.chips === BUY_IN_CHIPS, buyInSentAt);
    if (!boughtIn.ok) return boughtIn;
    const cashOutAck = requireAck("cash_out", await actions.cashOut(BUY_IN_CHIPS));
    if (!cashOutAck.ok) return cashOutAck;
    return success({
      deposit: deposited.value,
      buyInAckMs: buyInAck.value,
      seatUpdateAfterBuyInSendMs: roundMs(boughtIn.value.receivedAtMs - buyInSentAt),
      cashOutAckMs: cashOutAck.value,
    });
  };
  const moneyLeg = await runMoneyLeg();
  log(`money leg: ${moneyLeg.ok ? "passed" : moneyLeg.reason}`);

  const leaveSentAt = performance.now();
  const leaveAck = requireAck("leave", await actions.leave());
  if (!leaveAck.ok) return leaveAck;
  const leftLive = await liveSeat.waitFor("live seat update after leave", (snapshot) => snapshot.seatIndex === null, leaveSentAt);
  const leftPolled = await pollingSeat.waitFor("polled seat update after leave", (snapshot) => snapshot.seatIndex === null, leaveSentAt);
  if (!leftLive.ok) return leftLive;
  if (!leftPolled.ok) return leftPolled;

  for (const watched of [liveTable, liveSeat, pollingSeat]) watched.stop();
  liveFeed.close();
  pollingFeed.close();
  client.rollupBlockhashes.stop();
  const rollupUnits = await readTokenUnits(client.rollup, findWalletTokenAddress(guest.keypair.publicKey, mint));
  const sponsorLamportsAfter = await client.base.getBalance(sponsor, "confirmed");
  return success({
    guest: guest.keypair.publicKey.toBase58(),
    table: tableAddress.toBase58(),
    sponsor: sponsor.toBase58(),
    signatures: {
      sit: seated.value.signature,
      faucet: funded.value.signature,
      session: session.value.signature,
    },
    moneyLeg,
    latencyMs: {
      sitConfirm: roundMs(seated.value.confirmMs),
      faucetConfirm: roundMs(funded.value.confirmMs),
      baseSetupAllThree: roundMs(baseSetupMs),
      seatVisibleOnRollup: roundMs(seatVisibleMs),
      joinAck: joinAck.value,
      tableUpdateAfterJoinSend: roundMs(joinedTable.value.receivedAtMs - joinSentAt),
      leaveAck: leaveAck.value,
      liveSeatUpdateAfterLeaveSend: roundMs(leftLive.value.receivedAtMs - leaveSentAt),
      polledSeatUpdateAfterLeaveSend: roundMs(leftPolled.value.receivedAtMs - leaveSentAt),
    },
    feeds: { liveStatuses, pollingStatuses, liveTableSnapshots: liveTable.seen.length, liveSeatSnapshots: liveSeat.seen.length },
    testUsdcUnits: { baseAfterFaucet: baseUnits.ok ? baseUnits.value : null, rollupAfterCashOut: rollupUnits.ok ? rollupUnits.value : null },
    sponsorLamports: { before: sponsorLamportsBefore, after: sponsorLamportsAfter, spent: sponsorLamportsBefore - sponsorLamportsAfter },
    sponsorStatusAfter: await fetchSponsorStatus(routeUrl),
  });
};

const routeUrl = process.argv[2] ?? DEFAULT_ROUTE_URL;
const tableAddress = new PublicKey(process.argv[3] ?? DEFAULT_TABLE);
const outcome = await attempt(() => runGuestCheck(routeUrl, tableAddress, process.argv[4]));
const report = outcome.ok ? outcome.value : outcome;
log(JSON.stringify(report, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value instanceof PublicKey ? value.toBase58() : value), 2));
process.exit(outcome.ok && outcome.value.ok ? 0 : 1);
