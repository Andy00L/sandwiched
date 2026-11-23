import { fetchTable } from "../chain/accounts";
import { createChainClient, createSponsoredFeePayment } from "../chain/client";
import { SPONSOR_ROUTE_PATH } from "../chain/config";
import { loadGuestKey } from "../chain/guest-key";
import { createBrowserKeyStore } from "../chain/key-store";
import { sleep } from "../chain/result";
import { createKeypairSigner } from "../chain/transport";
import { DEFAULT_BUY_IN_CHIPS, createGuestPlayChain } from "./guest-chain";
import { fundAheadOfSeat } from "./guest-steps";
import { PRACTICE_TABLES } from "./table-listings";

const HEAD_START_MAX_ATTEMPTS_PER_STEP = 3;
const HEAD_START_RETRY_DELAY_MS = 1_500;
const HEAD_START_SETTLE_DELAY_MS = 400;

let headStart: Promise<void> | null = null;

async function runHeadStart(): Promise<void> {
  const [practice] = PRACTICE_TABLES;
  if (practice === undefined) return;
  const feePayment = await createSponsoredFeePayment(SPONSOR_ROUTE_PATH);
  if (!feePayment.ok) return console.warn(`[runHeadStart] ${feePayment.reason}`);
  const client = createChainClient(feePayment.value);
  const table = await fetchTable(client.programs.sandwich, client.rollup, practice.address);
  if (!table.ok || table.value === null) return console.warn(`[runHeadStart] practice table: ${table.ok ? "missing" : table.reason}`);
  const keyStore = createBrowserKeyStore();
  const wallet = createKeypairSigner(loadGuestKey(keyStore).keypair);
  const play = createGuestPlayChain({ client, wallet, table: practice.address, tableSnapshot: table.value, keyStore, signsWith: "session", buyInChips: DEFAULT_BUY_IN_CHIPS, payout: null });
  const startedAtMs = performance.now();
  const [session, funds] = await Promise.all([
    play.guest.run("session"),
    fundAheadOfSeat(play.guest, {
      needs: play.needs,
      maxAttemptsPerStep: HEAD_START_MAX_ATTEMPTS_PER_STEP,
      retryDelayMs: HEAD_START_RETRY_DELAY_MS,
      settleDelayMs: HEAD_START_SETTLE_DELAY_MS,
      onStage: () => undefined,
      wait: sleep,
      isStopped: () => false,
    }),
  ]);
  if (!session.ok) console.warn(`[runHeadStart] session: ${session.reason}`);
  if (funds.kind === "failed") console.warn(`[runHeadStart] ${funds.step}: ${funds.reason}`);
  console.log(`[runHeadStart] ready in ${Math.round(performance.now() - startedAtMs)} ms`);
}

export const startGuestHeadStart = (): Promise<void> => (headStart ??= runHeadStart());
