import {
  delegateSpl,
  deriveVault,
  deriveVaultAta,
  ensureMagicAtaDestinationIx,
  initVaultAtaIx,
  initVaultIx,
  isMagicAtaTokenAccount,
  withdrawSpl,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { type Connection, type Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import {
  BlockhashCache,
  ROLLUP_URL,
  type RollupAck,
  createBaseConnection,
  createRollupConnection,
  createRunKeypair,
  getValidatorIdentity,
  isDelegatedOnRollup,
  loadAdmin,
  readExecution,
  readLamports,
  readTokenUnits,
  sendOnBase,
  sendOnRollup,
  writeRunRecord,
} from "./chain";
import { type Result, attempt, failure, pollUntil, sleep, success, summarize } from "./result";
import {
  SANDWICH_PROGRAM_ID,
  type SandwichProgram,
  type SeatActor,
  type SeatView,
  type SessionProgram,
  type TableView,
  buildAnteIx,
  buildBuyInIx,
  buildCashOutIx,
  buildCreateSessionIx,
  buildCreateTableIxs,
  buildCreateTestMintIx,
  buildFaucetIx,
  buildFlyToIx,
  buildJoinIx,
  buildLandSwatIx,
  buildPeckIx,
  buildRaiseHandIx,
  buildRevokeSessionIx,
  buildSettleIx,
  buildSitIxs,
  buildStartRoundIx,
  buildTakeOffIx,
  createPrograms,
  custodyPda,
  decodeSeat,
  decodeTable,
  escrowAta,
  fetchSeat,
  fetchTable,
  nameError,
  seatPda,
  sessionTokenPda,
  tablePda,
  testMintPda,
  walletAta,
} from "./sandwich";

const PLAYER_COUNT = 6;
const ANTE_UNITS = 100_000n;
const BOX_COUNT = 3;
const DEPOSIT_UNITS = 1_000_000n;
const BUY_IN_CHIPS = 300n;
const PLAY_MS = 44_500;
const PECK_INTERVAL_MS = 330;
const SWAT_INTERVAL_MS = 1_300;
const FLIGHT_WAIT_MS = 550;
const EMPTY_BOX_STUN_WAIT_MS = 2_100;
const DODGE_WAIT_MS = 500;
const SESSION_VALIDITY_S = 3_600;
const PROPAGATION_TIMEOUT_MS = 90_000;
const DRAW_TIMEOUT_MS = 30_000;
const POLL_MS = 100;
const FAST_POLL_MS = 20;
const BLOCKHASH_REFRESH_MS = 1_000;

type Player = { name: string; wallet: Keypair; sessionSigner: Keypair };
type ActionRecord = { player: string; action: string; ok: boolean; kind: string; error: string | null; sentAtMs: number; ackMs: number };
type SwatLanding = { signature: string; landsTick: bigint; looseBefore: bigint[]; looseAfter: bigint[] };
type LandedSwat = SwatLanding & { computeUnits: number | null };
type Context = {
  program: SandwichProgram;
  session: SessionProgram;
  base: Connection;
  rollup: Connection;
  admin: Keypair;
  validator: PublicKey;
  mint: PublicKey;
  table: PublicKey;
  blockhashes: BlockhashCache;
};

const log = (functionName: string, message: string): void => console.log(`[${functionName}] ${message}`);

const actorOf = (context: Context, player: Player): SeatActor => ({
  signer: player.sessionSigner.publicKey,
  wallet: player.wallet.publicKey,
  table: context.table,
  sessionToken: sessionTokenPda(player.sessionSigner.publicKey, player.wallet.publicKey),
});

const describeAck = (ack: RollupAck): string => (ack.ok ? "ok" : `${ack.kind} ${nameError(ack.errorCode)}: ${ack.detail.slice(0, 160)}`);

const sendSetupOnRollup = async (context: Context, label: string, instruction: TransactionInstruction, signer: Keypair): Promise<Result<RollupAck>> => {
  const ack = await sendOnRollup(context.blockhashes, [instruction], [signer]);
  return ack.ok ? success(ack) : failure(`[sendSetupOnRollup] ${label}: ${describeAck(ack)}`);
};

const ensureMintAndVault = async (context: Omit<Context, "mint" | "table" | "blockhashes">, mint: PublicKey): Promise<Result<string>> => {
  if ((await context.base.getAccountInfo(mint)) === null) {
    const created = await sendOnBase(context.base, [await buildCreateTestMintIx(context.program, context.admin.publicKey)], [context.admin]);
    if (!created.ok) return failure(`[ensureMintAndVault] mint: ${created.reason}`);
  }
  const [vault] = deriveVault(mint);
  if ((await context.base.getAccountInfo(vault)) === null) {
    const vaultAta = deriveVaultAta(mint, vault);
    const initialized = await sendOnBase(
      context.base,
      [initVaultIx(vault, mint, context.admin.publicKey), initVaultAtaIx(context.admin.publicKey, vaultAta, vault, mint)],
      [context.admin],
    );
    if (!initialized.ok) return failure(`[ensureMintAndVault] vault: ${initialized.reason}`);
  }
  return success(vault.toBase58());
};

const waitForDelegation = (context: Context, account: PublicKey) =>
  pollUntil(
    `delegation of ${account.toBase58()}`,
    async () => {
      const info = await context.rollup.getAccountInfo(account, "processed");
      if (info === null || !info.owner.equals(SANDWICH_PROGRAM_ID)) return null;
      return (await isDelegatedOnRollup(account)) ? true : null;
    },
    PROPAGATION_TIMEOUT_MS,
    POLL_MS,
  );

const waitForTokenUnits = (connection: Connection, account: PublicKey, expected: bigint, label: string) =>
  pollUntil(label, async () => ((await readTokenUnits(connection, account)) === expected ? expected : null), PROPAGATION_TIMEOUT_MS, POLL_MS);

const seatPlayer = async (context: Context, player: Player): Promise<Result<string>> => {
  const admin = context.admin;
  const wallet = player.wallet.publicKey;
  const ata = walletAta(wallet, context.mint);
  const funded = await sendOnBase(
    context.base,
    [createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata, wallet, context.mint), await buildFaucetIx(context.program, admin.publicKey, wallet)],
    [admin, player.wallet],
  );
  if (!funded.ok) return failure(`[seatPlayer] ${player.name} faucet: ${funded.reason}`);
  const seated = await sendOnBase(context.base, await buildSitIxs(context.program, admin.publicKey, wallet, context.table), [admin, player.wallet]);
  if (!seated.ok) return failure(`[seatPlayer] ${player.name} sit: ${seated.reason}`);
  const validUntil = Math.floor(Date.now() / 1000) + SESSION_VALIDITY_S;
  const sessionIx = await buildCreateSessionIx(context.session, admin.publicKey, wallet, player.sessionSigner.publicKey, validUntil);
  const sessionOpened = await sendOnBase(context.base, [sessionIx], [admin, player.wallet, player.sessionSigner]);
  if (!sessionOpened.ok) return failure(`[seatPlayer] ${player.name} session: ${sessionOpened.reason}`);
  const seatVisible = await waitForDelegation(context, seatPda(context.table, wallet));
  if (!seatVisible.ok) return failure(`[seatPlayer] ${player.name}: ${seatVisible.reason}`);
  return success(player.name);
};

const depositToRollup = async (context: Context, player: Player): Promise<Result<bigint>> => {
  const admin = context.admin;
  const wallet = player.wallet.publicKey;
  const ata = walletAta(wallet, context.mint);
  const depositIxs = await delegateSpl(wallet, context.mint, DEPOSIT_UNITS, { validator: context.validator, payer: admin.publicKey });
  const deposited = await sendOnBase(context.base, depositIxs, [admin, player.wallet]);
  if (!deposited.ok) return failure(`[depositToRollup] ${player.name} deposit: ${deposited.reason}`);
  const depositVisible = await waitForTokenUnits(context.rollup, ata, DEPOSIT_UNITS, `${player.name} deposit on the rollup`);
  if (!depositVisible.ok) return failure(`[depositToRollup] ${depositVisible.reason}`);
  const tokensAfterDeposit = (await readTokenUnits(context.base, ata)) + (await readTokenUnits(context.rollup, ata));
  log("depositToRollup", `${player.name} deposited, ${tokensAfterDeposit} units across base and rollup`);
  return success(tokensAfterDeposit);
};

const readSeats = async (context: Context, players: Player[]): Promise<Result<SeatView[]>> => {
  const seats: SeatView[] = [];
  for (const player of players) {
    const seat = await fetchSeat(context.program, context.rollup, seatPda(context.table, player.wallet.publicKey));
    if (seat === null) return failure(`[readSeats] ${player.name} seat missing`);
    seats.push(seat);
  }
  return success(seats);
};

const sumChips = (seats: SeatView[]): bigint => seats.reduce((total, seat) => total + seat.chips, 0n);

type StunTally = { stunsSeen: number; swatStuns: number; crumbsDropped: bigint };

const watchStuns = (context: Context, players: Player[], tally: StunTally): number[] => {
  const previous = new Map<string, SeatView>();
  return players.map((player) =>
    context.rollup.onAccountChange(
      seatPda(context.table, player.wallet.publicKey),
      (info) => {
        const seat = decodeSeat(context.program, info.data);
        const before = previous.get(player.name);
        previous.set(player.name, seat);
        if (before === undefined || seat.pigeon.kind !== "stunned") return;
        const isNewStun = before.pigeon.kind !== "stunned" || before.pigeon.untilTick !== seat.pigeon.untilTick;
        if (!isNewStun) return;
        tally.stunsSeen += 1;
        if (seat.beakCrumbs < before.beakCrumbs) {
          tally.swatStuns += 1;
          tally.crumbsDropped += before.beakCrumbs - seat.beakCrumbs;
        }
      },
      { commitment: "processed" },
    ),
  );
};

const readLandedSwats = async (context: Context, landings: SwatLanding[]): Promise<LandedSwat[]> => {
  const landed: LandedSwat[] = [];
  for (const landing of landings) {
    const execution = await pollUntil(`land_swat ${landing.signature}`, () => readExecution(context.rollup, landing.signature), 10_000, 250);
    landed.push({
      ...landing,
      computeUnits: execution.ok ? execution.value.computeUnits : null,
    });
  }
  return landed;
};

const playRound = async (
  context: Context,
  players: Player[],
  live: TableView,
  liveTable: { view: TableView },
): Promise<{ records: ActionRecord[]; landings: SwatLanding[] }> => {
  const landings: SwatLanding[] = [];
  if (live.phase.kind !== "live") return { records: [], landings };
  const whaleWallet = live.seats[live.phase.whaleSeat];
  const whale = players.find((player) => whaleWallet !== undefined && player.wallet.publicKey.equals(whaleWallet));
  const pigeons = players.filter((player) => player !== whale);
  const records: ActionRecord[] = [];
  const playStartedAt = performance.now();
  const stopAt = playStartedAt + PLAY_MS;
  const sandwichBox = live.sandwichBox;
  const emptyBox = (sandwichBox + 1) % BOX_COUNT;
  const isPlaying = () => performance.now() < stopAt;

  const act = async (player: Player, action: string, instruction: TransactionInstruction): Promise<RollupAck> => {
    const sentAtMs = Math.round(performance.now() - playStartedAt);
    const ack = await sendOnRollup(context.blockhashes, [instruction], [player.sessionSigner]);
    records.push({
      player: player.name,
      action,
      ok: ack.ok,
      kind: ack.ok ? "ok" : ack.kind,
      error: ack.ok ? null : nameError(ack.errorCode),
      sentAtMs,
      ackMs: ack.ackMs,
    });
    return ack;
  };
  const peckLoop = async (player: Player, dodgesSwats: boolean) => {
    let lastSwatCount = liveTable.view.swatCount;
    while (isPlaying()) {
      const swatCount = liveTable.view.swatCount;
      const hand = liveTable.view.hand;
      if (dodgesSwats && swatCount > lastSwatCount && hand.kind === "raised" && hand.boxIndex === sandwichBox) {
        lastSwatCount = swatCount;
        await act(player, "take_off", await buildTakeOffIx(context.program, actorOf(context, player)));
        await sleep(DODGE_WAIT_MS);
        await act(player, "fly_to", await buildFlyToIx(context.program, actorOf(context, player), sandwichBox));
        await sleep(FLIGHT_WAIT_MS);
        continue;
      }
      await act(player, "peck", await buildPeckIx(context.program, actorOf(context, player)));
      await sleep(PECK_INTERVAL_MS + Math.floor(Math.random() * 40));
    }
  };
  const greedy = async (player: Player) => {
    await act(player, "fly_to", await buildFlyToIx(context.program, actorOf(context, player), sandwichBox));
    await sleep(FLIGHT_WAIT_MS);
    await peckLoop(player, false);
  };
  const nervous = async (player: Player) => {
    await act(player, "fly_to", await buildFlyToIx(context.program, actorOf(context, player), sandwichBox));
    await sleep(FLIGHT_WAIT_MS);
    await peckLoop(player, true);
  };
  const wanderer = async (player: Player) => {
    await act(player, "fly_to", await buildFlyToIx(context.program, actorOf(context, player), emptyBox));
    await sleep(FLIGHT_WAIT_MS);
    await act(player, "peck", await buildPeckIx(context.program, actorOf(context, player)));
    await sleep(EMPTY_BOX_STUN_WAIT_MS);
    await greedy(player);
  };
  const seats = players.map((player) => seatPda(context.table, player.wallet.publicKey));
  const landRaisedSwat = async (player: Player) => {
    const raised = await fetchTable(context.program, context.rollup, context.table);
    if (raised === null || raised.hand.kind !== "raised") return;
    const landsTick = raised.hand.landsTick;
    const hasLanded = await pollUntil(
      "swat landing slot",
      async () => (BigInt(await context.rollup.getSlot("processed")) >= landsTick ? true : null),
      PROPAGATION_TIMEOUT_MS,
      FAST_POLL_MS,
    );
    if (!hasLanded.ok) return;
    const looseBefore = (await fetchTable(context.program, context.rollup, context.table))?.looseCrumbs ?? [];
    const ack = await act(player, "land_swat", await buildLandSwatIx(context.program, context.table, seats));
    const looseAfter = (await fetchTable(context.program, context.rollup, context.table))?.looseCrumbs ?? [];
    if (ack.ok) landings.push({ signature: ack.signature, landsTick, looseBefore, looseAfter });
  };
  const whaleLoop = async (player: Player) => {
    while (isPlaying()) {
      await sleep(SWAT_INTERVAL_MS);
      if (!isPlaying()) continue;
      const raised = await act(player, "raise_hand", await buildRaiseHandIx(context.program, actorOf(context, player), sandwichBox));
      if (raised.ok) await landRaisedSwat(player);
    }
  };
  const roles = pigeons.map((pigeon, index) => (index === 3 ? nervous(pigeon) : index === 4 ? wanderer(pigeon) : greedy(pigeon)));
  await Promise.all([...roles, ...(whale === undefined ? [] : [whaleLoop(whale)])]);
  return { records, landings };
};

const settleRound = async (context: Context, players: Player[], endTick: bigint): Promise<Result<{ signature: string; computeUnits: number | null }>> => {
  const ended = await pollUntil(
    "round end slot",
    async () => (BigInt(await context.rollup.getSlot("processed")) >= endTick ? true : null),
    PROPAGATION_TIMEOUT_MS,
    POLL_MS,
  );
  if (!ended.ok) return ended;
  const seats = players.map((player) => seatPda(context.table, player.wallet.publicKey));
  const settled = await sendSetupOnRollup(context, "settle", await buildSettleIx(context.program, context.table, seats), context.admin);
  if (!settled.ok || !settled.value.ok) return failure(settled.ok ? "[settleRound] no signature" : settled.reason);
  const signature = settled.value.signature;
  const execution = await pollUntil("settle transaction", () => readExecution(context.rollup, signature), 10_000, 250);
  return success({ signature, computeUnits: execution.ok ? execution.value.computeUnits : null });
};

const cashOutAndWithdraw = async (context: Context, player: Player): Promise<Result<bigint>> => {
  const seat = await fetchSeat(context.program, context.rollup, seatPda(context.table, player.wallet.publicKey));
  if (seat === null) return failure(`[cashOutAndWithdraw] ${player.name} seat missing`);
  if (seat.chips > 0n) {
    const cashed = await sendSetupOnRollup(context, `${player.name} cash_out`, await buildCashOutIx(context.program, actorOf(context, player), context.mint, seat.chips), player.sessionSigner);
    if (!cashed.ok) return cashed;
  }
  const ata = walletAta(player.wallet.publicKey, context.mint);
  const rollupUnits = await readTokenUnits(context.rollup, ata);
  const baseUnits = await readTokenUnits(context.base, ata);
  const rollupInfo = await context.rollup.getAccountInfo(ata, "processed");
  const magicAtaSource = rollupInfo !== null && isMagicAtaTokenAccount(rollupInfo.data);
  const withdrawIxs = await withdrawSpl(player.wallet.publicKey, context.mint, rollupUnits, { validator: context.validator, payer: context.admin.publicKey, magicAtaSource });
  const withdrawn = await sendOnBase(context.base, withdrawIxs, [context.admin, player.wallet]);
  if (!withdrawn.ok) return failure(`[cashOutAndWithdraw] ${player.name} withdraw: ${withdrawn.reason}`);
  const landed = await waitForTokenUnits(context.base, ata, baseUnits + rollupUnits, `${player.name} withdrawal on base`);
  if (!landed.ok) return landed;
  const revoked = await sendOnBase(
    context.base,
    [await buildRevokeSessionIx(context.session, context.admin.publicKey, player.wallet.publicKey, player.sessionSigner.publicKey)],
    [context.admin, player.wallet],
  );
  if (!revoked.ok) log("cashOutAndWithdraw", `${player.name} session revoke failed: ${revoked.reason}`);
  return success((await readTokenUnits(context.base, ata)) + (await readTokenUnits(context.rollup, ata)));
};

const runHeadlessRound = async (): Promise<Result<Record<string, unknown>>> => {
  const adminLoaded = loadAdmin();
  if (!adminLoaded.ok) return adminLoaded;
  const admin = adminLoaded.value;
  const base = createBaseConnection();
  const rollup = createRollupConnection();
  const { sandwich: program, session } = createPrograms(base, admin);
  const validatorIdentity = await getValidatorIdentity(ROLLUP_URL);
  if (!validatorIdentity.ok) return validatorIdentity;
  const validator = new PublicKey(validatorIdentity.value);
  const adminLamportsBefore = await readLamports(base, admin.publicKey);
  const mint = testMintPda();
  const vault = await ensureMintAndVault({ program, session, base, rollup, admin, validator }, mint);
  if (!vault.ok) return vault;

  const runName = `run-${Date.now()}`;
  const players: Player[] = [];
  for (let index = 0; index < PLAYER_COUNT; index += 1) {
    const wallet = createRunKeypair(runName, `player-${index}`);
    const sessionSigner = createRunKeypair(runName, `session-${index}`);
    if (!wallet.ok || !sessionSigner.ok) return failure("[runHeadlessRound] cannot create player keys");
    players.push({ name: `player-${index}`, wallet: wallet.value, sessionSigner: sessionSigner.value });
  }
  const tableId = BigInt(Date.now());
  const table = tablePda(tableId);
  const blockhashes = new BlockhashCache(rollup, BLOCKHASH_REFRESH_MS);
  const blockhashReady = await blockhashes.start();
  if (!blockhashReady.ok) return blockhashReady;
  const context: Context = { program, session, base, rollup, admin, validator, mint, table, blockhashes };
  log("runHeadlessRound", `run ${runName}, table ${table.toBase58()}, validator ${validator.toBase58()}`);

  const created = await sendOnBase(base, await buildCreateTableIxs(program, admin.publicKey, { tableId, anteUnits: ANTE_UNITS, boxCount: BOX_COUNT, validator, mint }), [admin]);
  if (!created.ok) return failure(`[runHeadlessRound] create table: ${created.reason}`);
  const tableVisible = await waitForDelegation(context, table);
  if (!tableVisible.ok) return tableVisible;
  const escrow = escrowAta(table, mint);
  const escrowOpened = await sendSetupOnRollup(context, "escrow Magic ATA", ensureMagicAtaDestinationIx(admin.publicKey, custodyPda(table), mint), admin);
  if (!escrowOpened.ok) return escrowOpened;
  const escrowVisible = await pollUntil("escrow on the rollup", async () => ((await rollup.getAccountInfo(escrow, "processed")) === null ? null : true), PROPAGATION_TIMEOUT_MS, POLL_MS);
  if (!escrowVisible.ok) return escrowVisible;

  const seated = await Promise.all(players.map((player) => seatPlayer(context, player)));
  for (const outcome of seated) {
    if (!outcome.ok) return outcome;
  }
  let tokensBefore = await readTokenUnits(rollup, escrow);
  // One deposit at a time: parallel delegateSpl deposits landing in one slot left a shuttle that devnet-us never merged (plan/01-facts.md section F).
  for (const player of players) {
    const deposited = await depositToRollup(context, player);
    if (!deposited.ok) return deposited;
    tokensBefore += deposited.value;
  }
  for (const player of players) {
    const joined = await sendSetupOnRollup(context, `${player.name} join`, await buildJoinIx(program, actorOf(context, player)), player.sessionSigner);
    if (!joined.ok) return joined;
    const boughtIn = await sendSetupOnRollup(context, `${player.name} buy_in`, await buildBuyInIx(program, player.wallet.publicKey, table, mint, BUY_IN_CHIPS), player.wallet);
    if (!boughtIn.ok) return boughtIn;
  }
  const seatsBefore = await readSeats(context, players);
  if (!seatsBefore.ok) return seatsBefore;
  const chipsBefore = sumChips(seatsBefore.value);
  const lobbyTable = await fetchTable(program, rollup, table);
  if (lobbyTable === null) return failure("[runHeadlessRound] table missing");
  const escrowBefore = await readTokenUnits(rollup, escrow);
  const escrowBacksChipsBefore = escrowBefore === chipsBefore * lobbyTable.chipUnits;

  const liveTable = { view: lobbyTable };
  const tableListener = rollup.onAccountChange(table, (info) => { liveTable.view = decodeTable(program, info.data); }, { commitment: "processed" });
  const stunTally: StunTally = { stunsSeen: 0, swatStuns: 0, crumbsDropped: 0n };
  const seatListeners = watchStuns(context, players, stunTally);

  for (const player of players) {
    const anted = await sendSetupOnRollup(context, `${player.name} ante`, await buildAnteIx(program, actorOf(context, player)), player.sessionSigner);
    if (!anted.ok) return anted;
  }
  const drawStartedAt = performance.now();
  const started = await sendSetupOnRollup(context, "start_round", await buildStartRoundIx(program, admin.publicKey, table), admin);
  if (!started.ok) return started;
  const live = await pollUntil(
    "VRF callback",
    async () => {
      const view = await fetchTable(program, rollup, table);
      return view !== null && view.phase.kind === "live" ? view : null;
    },
    DRAW_TIMEOUT_MS,
    FAST_POLL_MS,
  );
  if (!live.ok) return live;
  const drawMs = performance.now() - drawStartedAt;
  liveTable.view = live.value;
  log("runHeadlessRound", `whale drawn in ${drawMs.toFixed(0)} ms, sandwich box ${live.value.sandwichBox}, end tick ${live.value.endTick}`);

  const { records, landings } = await playRound(context, players, live.value, liveTable);
  const settled = await settleRound(context, players, live.value.endTick);
  if (!settled.ok) return settled;
  const landedSwats = await readLandedSwats(context, landings);
  const afterSettle = await fetchTable(program, rollup, table);
  const seatsAfter = await readSeats(context, players);
  if (!seatsAfter.ok || afterSettle === null) return failure("[runHeadlessRound] cannot read the table after settle");
  const chipsAfter = sumChips(seatsAfter.value);
  const escrowAfterSettle = await readTokenUnits(rollup, escrow);
  await rollup.removeAccountChangeListener(tableListener);
  await Promise.all(seatListeners.map((listener) => rollup.removeAccountChangeListener(listener)));

  const withdrawn = await Promise.all(players.map((player) => cashOutAndWithdraw(context, player)));
  let tokensAfter = await readTokenUnits(rollup, escrow);
  for (const outcome of withdrawn) {
    if (!outcome.ok) return outcome;
    tokensAfter += outcome.value;
  }
  blockhashes.stop();
  const adminLamportsAfter = await readLamports(base, admin.publicKey);

  const succeeded = records.filter((record) => record.ok);
  const refusedByRule = records.filter((record) => record.kind === "program");
  const transportFailures = records.filter((record) => record.kind === "transport" || record.kind === "validator");
  const refusalCounts: Record<string, number> = {};
  for (const record of refusedByRule) refusalCounts[record.error ?? "unknown"] = (refusalCounts[record.error ?? "unknown"] ?? 0) + 1;
  const isChipsConserved = chipsBefore === chipsAfter;
  const isTokensConserved = tokensBefore === tokensAfter;
  const report = {
    runName,
    table: table.toBase58(),
    endpoint: ROLLUP_URL,
    validator: validator.toBase58(),
    pass: isChipsConserved && isTokensConserved && escrowBacksChipsBefore && escrowAfterSettle === chipsAfter * afterSettle.chipUnits && transportFailures.length === 0,
    chips: { before: chipsBefore, after: chipsAfter, conserved: isChipsConserved },
    escrow: { beforeRound: escrowBefore, afterSettle: escrowAfterSettle, backsChipsBefore: escrowBacksChipsBefore },
    tokens: { before: tokensBefore, after: tokensAfter, conserved: isTokensConserved },
    drawMs: Math.round(drawMs),
    lastResult: afterSettle.lastResult,
    swatCount: afterSettle.swatCount,
    stuns: stunTally,
    actions: {
      sent: records.length,
      succeeded: succeeded.length,
      refusedByRule: refusedByRule.length,
      transportFailures: transportFailures.length,
      refusals: refusalCounts,
      firstTransportFailures: transportFailures.slice(0, 3),
    },
    ackMs: { all: summarize(records.map((record) => record.ackMs)), succeeded: summarize(succeeded.map((record) => record.ackMs)) },
    settle: settled.value,
    landSwat: {
      succeeded: landedSwats.length,
      computeUnits: summarize(landedSwats.flatMap((landed) => (landed.computeUnits === null ? [] : [landed.computeUnits]))),
    },
    adminSpentLamports: adminLamportsBefore - adminLamportsAfter,
  };
  writeRunRecord(runName, { ...report, records, landedSwats });
  return success(report);
};

const outcome = await attempt(runHeadlessRound);
if (!outcome.ok || !outcome.value.ok) {
  log("main", `IT-1 failed: ${outcome.ok ? (outcome.value.ok ? "" : outcome.value.reason) : outcome.reason}`);
  process.exit(1);
}
log("main", JSON.stringify(outcome.value.value, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value), 2));
process.exit(0);
