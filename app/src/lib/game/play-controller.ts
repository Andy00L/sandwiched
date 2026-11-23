import type { PublicKey } from "@solana/web3.js";
import { type WalletChoice, connectPayoutWallet } from "../chain/browser-wallets";
import { loadGuestKey } from "../chain/guest-key";
import { createBrowserKeyStore } from "../chain/key-store";
import type { Result } from "../chain/result";
import { createKeypairSigner } from "../chain/transport";
import { ROLE_SHEET_S, revealSheetDelayS } from "../table/motion/motion-tokens";
import { captureSceneFrame } from "../table/stage/scene-capture";
import { readPigeonBox } from "./chain-rules";
import type { ClickTarget } from "./click-intent";
import { startGuestHeadStart } from "./guest-head-start";
import type { GuestStage } from "./guest-steps";
import { type LivePlay, openLivePlay } from "./live-table";
import { type Drawer, INITIAL_PLAY_STATE, type PlayEvent, type PlayState, type Role, isTableOpenForPlay, stepPlay, summarizeRound } from "./play-flow";
import { openPracticePlay } from "./practice-table";
import type { RoundSource } from "./round-source";
import type { TableListing } from "./table-listings";

const PLAY_WAIT_MS = 120_000;
const BOX_KEYS: Readonly<Record<string, number>> = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 };
const TAKE_OFF_KEYS = new Set(["KeyW", "ArrowUp"]);

export type SeatWallet = { kind: "guest" } | { kind: "browser"; choice: WalletChoice };

export type PlayController = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => PlayState;
  pickTable: (table: TableListing) => void;
  goHome: () => void;
  playNow: (buyInChips: bigint, seatWallet: SeatWallet) => void;
  anteAgain: () => void;
  cashOut: () => void;
  openShare: () => void;
  closeShare: () => void;
  toggleDrawer: (drawer: Drawer) => void;
  closeDrawer: () => void;
  clickTable: (target: ClickTarget) => void;
  handleKey: (event: KeyboardEvent) => void;
};

export type PlayControllerPorts = { onLiveSource: (source: RoundSource, readOwnSeat: () => number | null) => void; onMuteKey: () => void };

const openListedTable = (table: TableListing, buyInChips: bigint, payout: PublicKey | null, onStage: (stage: GuestStage) => void): Promise<Result<LivePlay>> => {
  if (table.kind === "practice") return openPracticePlay(PLAY_WAIT_MS, "whenAsked", payout, onStage);
  const keyStore = createBrowserKeyStore();
  const wallet = createKeypairSigner(loadGuestKey(keyStore).keypair);
  return openLivePlay({ table: table.address, keyStore, wallet, timeoutMs: PLAY_WAIT_MS, buyInChips, payout, antePolicy: "whenAsked", onStage, startCompanions: null });
};

export function createPlayController(ports: PlayControllerPorts): PlayController {
  let state = INITIAL_PLAY_STATE;
  let play: LivePlay | null = null;
  let cashOutOfLastPlay: LivePlay["cashOut"] | null = null;
  const listeners = new Set<() => void>();

  const dispatch = (event: PlayEvent) => {
    const next = stepPlay(state, event);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };

  const showRole = (roundNumber: number, role: Role) => {
    if (state.lastRoleRound === roundNumber) return;
    dispatch({ kind: "roundLive", roundNumber, role });
    setTimeout(() => dispatch({ kind: "roleSeen", roundNumber }), ROLE_SHEET_S * 1000);
  };

  const watchRounds = (opened: LivePlay) => {
    const playedRounds = new Set<number>();
    const settledRounds = new Set<number>();
    const boxCount = opened.source.boxCount;
    opened.store.subscribe(() => {
      const { live, previous, ownSeat } = opened.store.getSnapshot();
      if (ownSeat === null) return;
      for (const round of [previous, live]) {
        if (round === null) continue;
        const seat = round.view.seats.find((candidate) => candidate.seat === ownSeat);
        if (round.view.phase === "live" && seat?.presence === "anted") {
          playedRounds.add(round.roundNumber);
          showRole(round.roundNumber, seat.role);
        }
        if (round.view.phase !== "settled" || !playedRounds.has(round.roundNumber) || settledRounds.has(round.roundNumber)) continue;
        const summary = summarizeRound(round.roundNumber, round.round, ownSeat, opened.tableSnapshot.address.toBase58());
        if (summary === null) continue;
        settledRounds.add(round.roundNumber);
        setTimeout(() => dispatch({ kind: "roundSettled", summary, frame: captureSceneFrame() }), revealSheetDelayS(boxCount) * 1000);
      }
    });
  };

  const playNow = async (buyInChips: bigint, seatWallet: SeatWallet) => {
    if (state.flow.kind !== "seat" || state.flow.sheet.phase === "seating") return;
    const table = state.flow.table;
    dispatch({ kind: "playNow", walletName: seatWallet.kind === "browser" ? seatWallet.choice.name : null });
    const onPrompt = (isWaiting: boolean) => dispatch({ kind: "walletPrompt", isWaiting });
    const connected = seatWallet.kind === "browser" ? await connectPayoutWallet(seatWallet.choice, onPrompt) : null;
    if (connected !== null && !connected.ok) {
      console.warn(`[playNow] ${connected.reason}`);
      dispatch({ kind: "walletFailed", reason: connected.reason });
      return;
    }
    await startGuestHeadStart();
    const opened = await openListedTable(table, buyInChips, connected?.value ?? null, (stage) => dispatch({ kind: "seatStage", stage }));
    if (!opened.ok) {
      console.warn(`[playNow] ${opened.reason}`);
      dispatch({ kind: "seatStage", stage: { kind: "failed", step: "sit", reason: opened.reason } });
      return;
    }
    play = opened.value;
    ports.onLiveSource(opened.value.source, () => opened.value.store.getSnapshot().ownSeat);
    opened.value.player.anteNextRound();
    watchRounds(opened.value);
  };

  const clickTable = (target: ClickTarget) => {
    if (play === null || !isTableOpenForPlay(state)) return;
    dispatch({ kind: "acted" });
    play.player.click(target);
  };

  const clickOwnBox = () => {
    if (play === null) return;
    const { live, ownSeat } = play.store.getSnapshot();
    const seat = live?.view.seats.find((candidate) => candidate.seat === ownSeat);
    const box = seat === undefined ? null : readPigeonBox(seat.pigeon);
    if (box !== null) clickTable({ kind: "box", box });
  };

  const anteAgain = () => {
    if (state.flow.kind !== "table" || state.flow.overlay.kind !== "results") return;
    dispatch({ kind: "anteAgain" });
    play?.player.anteNextRound();
  };

  const cashOut = async () => {
    const overlay = state.flow.kind === "table" ? state.flow.overlay.kind : null;
    if (overlay !== "results" && overlay !== "receipt") return;
    if (play !== null) {
      cashOutOfLastPlay = play.cashOut;
      play.close();
      play = null;
    }
    if (cashOutOfLastPlay === null) return;
    dispatch({ kind: "cashOutStarted" });
    const receipt = await cashOutOfLastPlay();
    if (!receipt.ok) console.warn(`[cashOut] ${receipt.reason}`);
    dispatch({ kind: "cashOutEnded", receipt: receipt.ok ? receipt.value : { kind: "untouched", reason: receipt.reason } });
  };

  const handleKey = (event: KeyboardEvent) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code === "KeyH") return dispatch({ kind: "toggleDrawer", drawer: "help" });
    if (event.code === "KeyM") return ports.onMuteKey();
    if (event.code === "Escape") return dispatch(state.drawer === null ? { kind: "toggleDrawer", drawer: "settings" } : { kind: "closeDrawer" });
    if (event.code === "Enter" && state.flow.kind === "table" && state.flow.overlay.kind === "results") return anteAgain();
    const box = BOX_KEYS[event.code];
    if (box !== undefined) return clickTable({ kind: "box", box });
    if (event.code === "Space") {
      event.preventDefault();
      return clickOwnBox();
    }
    if (TAKE_OFF_KEYS.has(event.code)) clickTable({ kind: "ground" });
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    pickTable: (table) => {
      void startGuestHeadStart();
      dispatch({ kind: "pickTable", table });
    },
    goHome: () => dispatch({ kind: "goHome" }),
    playNow: (buyInChips, seatWallet) => void playNow(buyInChips, seatWallet),
    anteAgain,
    cashOut: () => void cashOut(),
    openShare: () => dispatch({ kind: "openShare" }),
    closeShare: () => dispatch({ kind: "closeShare" }),
    toggleDrawer: (drawer) => dispatch({ kind: "toggleDrawer", drawer }),
    closeDrawer: () => dispatch({ kind: "closeDrawer" }),
    clickTable,
    handleKey,
  };
}
