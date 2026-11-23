"use client";

import Image from "next/image";
import { useState, useSyncExternalStore } from "react";
import { type WalletChoice, walletDirectory } from "@/lib/chain/browser-wallets";
import { CHIPS_PER_ANTE, FAUCET_UNITS } from "@/lib/game/chain-rules";
import { formatUsdc } from "@/lib/game/game-session";
import type { GuestStep } from "@/lib/game/guest-steps";
import type { SeatWallet } from "@/lib/game/play-controller";
import type { PlayFlow } from "@/lib/game/play-flow";
import { ChipStackIcon } from "./CutPaperIcons";
import { InkButton } from "./InkButton";
import { PaperSheet } from "./PaperSheet";
import styles from "./paper.module.css";
import { useLatestShown } from "./use-latest-shown";

type SeatFlow = Extract<PlayFlow, { kind: "seat" }>;

const CHIP_CHOICES = [200n, 400n, 800n] as const;
const DEFAULT_CHIPS = 400n;

const STEP_WORDS: Record<GuestStep, string> = {
  sit: "Taking a perch",
  session: "Signing you in for the hour",
  join: "Sitting down",
  fund: "Getting test USDC",
  deposit: "Moving the USDC to the table",
  buyIn: "Buying chips",
};

const FAILURE_WORDS: Record<GuestStep | "wallet", string> = {
  wallet: "Your wallet did not approve.",
  sit: "The table did not take the seat.",
  session: "The session key was not signed.",
  join: "The table is full or closed.",
  fund: "The test USDC faucet did not answer.",
  deposit: "The USDC did not reach the table.",
  buyIn: "The chips were not bought.",
};

const WALLET_ICON_PX = 20;
const GUEST_WALLET: SeatWallet = { kind: "guest" };

export type SeatSheetProps = { flow: SeatFlow | null; onPlay: (buyInChips: bigint, seatWallet: SeatWallet) => void; onBack: () => void };

const FAUCET_LIMIT_REASON = `More than the ${formatUsdc(FAUCET_UNITS)} test USDC the faucet gives in an hour`;

function ChipChoice({ chipUnits, chosen, onChoose }: { chipUnits: bigint; chosen: bigint; onChoose: (chips: bigint) => void }) {
  return (
    <div className={styles.actions} role="group" aria-label="Chips to buy">
      {CHIP_CHOICES.map((chips) => (
        <button
          key={chips.toString()}
          type="button"
          className={styles.link}
          aria-pressed={chips === chosen}
          disabled={chips * chipUnits > FAUCET_UNITS}
          title={chips * chipUnits > FAUCET_UNITS ? FAUCET_LIMIT_REASON : undefined}
          onClick={() => onChoose(chips)}
        >
          <ChipStackIcon chips={Number(chips)} size={44} />
          <span style={{ display: "block", fontWeight: chips === chosen ? 700 : 400, textDecoration: chips === chosen ? "underline" : "none" }}>
            {chips.toString()} chips
          </span>
          <span className={styles.small}>{formatUsdc(chips * chipUnits)} test USDC</span>
        </button>
      ))}
    </div>
  );
}

function WalletChoices({ wallets, onPick }: { wallets: readonly WalletChoice[]; onPick: (choice: WalletChoice) => void }) {
  if (wallets.length === 0) return null;
  return (
    <>
      <p className={styles.label}>Or use your wallet</p>
      <div className={styles.actions}>
        {wallets.map((choice) => (
          <InkButton key={choice.name} onPress={() => onPick(choice)}>
            <span className={styles.walletName}>
              <Image src={choice.icon} alt="" width={WALLET_ICON_PX} height={WALLET_ICON_PX} unoptimized />
              {choice.name}
            </span>
          </InkButton>
        ))}
      </div>
      <p className={styles.small}>Your wallet signs up to five times to seat you. After that, pecking needs no popups for one hour.</p>
    </>
  );
}

function describeSeating(sheet: Extract<SeatFlow["sheet"], { phase: "seating" }>): string {
  if (sheet.walletName !== null && sheet.isAwaitingWallet) return `Waiting for you in ${sheet.walletName}`;
  if (sheet.step !== null) return STEP_WORDS[sheet.step];
  return sheet.walletName === null ? "Opening a test wallet" : `Connecting ${sheet.walletName}`;
}

export function SeatSheet({ flow, onPlay, onBack }: SeatSheetProps) {
  const shown = useLatestShown(flow);
  const wallets = useSyncExternalStore(walletDirectory.subscribe, walletDirectory.getSnapshot, walletDirectory.getServerSnapshot);
  const [chosenChips, setChosenChips] = useState<bigint>(DEFAULT_CHIPS);
  const [lastWallet, setLastWallet] = useState<SeatWallet>(GUEST_WALLET);
  const play = (seatWallet: SeatWallet) => {
    setLastWallet(seatWallet);
    onPlay(chosenChips, seatWallet);
  };
  if (shown === null) return (
      <PaperSheet isOpen={false} size="full" seed={11} label="Seat">
        {null}
      </PaperSheet>
    );
  const { table, sheet } = shown;
  const isPractice = table.kind === "practice";
  const chipUnits = table.anteUnits / BigInt(CHIPS_PER_ANTE);
  const label = isPractice ? "Practice table" : `Table · ante ${formatUsdc(table.anteUnits)} test USDC`;
  return (
    <PaperSheet isOpen={flow !== null} size="full" seed={11} label={label}>
      <p className={styles.label}>{label}</p>
      {sheet.phase === "choosing" ? (
        <>
          <h2 className={styles.title}>{isPractice ? "Six bots, one of them hungry" : "Pull up a perch"}</h2>
          {isPractice ? null : <ChipChoice chipUnits={chipUnits} chosen={chosenChips} onChoose={setChosenChips} />}
          <p className={styles.body}>A test wallet is made in this browser and filled with test USDC. Nothing to install, nothing to sign.</p>
          <div className={styles.actions}>
            <InkButton isPrimary onPress={() => play(GUEST_WALLET)}>
              Play now
            </InkButton>
            <button type="button" className={styles.link} onClick={onBack}>
              Back to the park
            </button>
          </div>
          {isPractice ? null : <WalletChoices wallets={wallets} onPick={(choice) => play({ kind: "browser", choice })} />}
        </>
      ) : null}
      {sheet.phase === "seating" ? (
        <>
          <h2 className={styles.title}>
            Finding you a perch
            <span className={styles.dots} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </h2>
          <p className={styles.body} aria-live="polite">
            {describeSeating(sheet)}
          </p>
        </>
      ) : null}
      {sheet.phase === "failed" ? (
        <>
          <h2 className={styles.title}>No perch this time</h2>
          <p className={styles.body}>{FAILURE_WORDS[sheet.step]}</p>
          <p className={styles.small}>{sheet.reason}</p>
          <div className={styles.actions}>
            <InkButton isPrimary onPress={() => play(lastWallet)}>
              Try again
            </InkButton>
            <button type="button" className={styles.link} onClick={onBack}>
              Back to the park
            </button>
          </div>
        </>
      ) : null}
    </PaperSheet>
  );
}
