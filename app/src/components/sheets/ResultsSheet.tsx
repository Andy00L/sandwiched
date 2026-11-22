"use client";

import { CHIPS_PER_ANTE } from "@/lib/game/chain-rules";
import { formatUsdc } from "@/lib/game/game-session";
import { type RoundSummary, chooseRoundTitle } from "@/lib/game/play-flow";
import type { TableListing } from "@/lib/game/table-listings";
import { PaperPlate } from "./CutPaperIcons";
import { InkButton } from "./InkButton";
import { PaperSheet } from "./PaperSheet";
import styles from "./paper.module.css";
import { useLatestShown } from "./use-latest-shown";

export type ResultsSheetProps = { summary: RoundSummary | null; table: TableListing | null; onAnteAgain: () => void; onCashOut: () => void };

const describeOwnLine = (summary: RoundSummary, usdc: string): string =>
  summary.ownRole === "whale" ? `You kept ${summary.ownCrumbs} crumbs. That is ${usdc} test USDC.` : `You pecked ${summary.ownCrumbs} crumbs. That is ${usdc} test USDC.`;

export function ResultsSheet({ summary, table, onAnteAgain, onCashOut }: ResultsSheetProps) {
  const shown = useLatestShown(summary);
  const shownTable = useLatestShown(table);
  if (shown === null || shownTable === null) {
    return (
      <PaperSheet isOpen={false} size="full" seed={37} label="Results">
        {null}
      </PaperSheet>
    );
  }
  const chipUnits = shownTable.anteUnits / BigInt(CHIPS_PER_ANTE);
  const crumbsInUsdc = (crumbs: number) => formatUsdc(BigInt(crumbs) * chipUnits);
  const pot = shown.whaleCrumbs + shown.pigeonCrumbs;
  const whaleShare = pot === 0 ? 1 : shown.whaleCrumbs / pot;
  return (
    <PaperSheet isOpen={summary !== null} size="full" seed={37} label="Results">
      <p className={styles.label}>Round {shown.roundNumber}</p>
      <h2 className={styles.title}>{chooseRoundTitle(shown)}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <figure style={{ margin: 0 }}>
          <PaperPlate size={150} fill={whaleShare} kind="sandwich" />
          <figcaption className={styles.small}>
            The whale kept {shown.whaleCrumbs} crumbs, {crumbsInUsdc(shown.whaleCrumbs)} test USDC
          </figcaption>
        </figure>
        <figure style={{ margin: 0 }}>
          <PaperPlate size={150} fill={1 - whaleShare} kind="crumbs" />
          <figcaption className={styles.small}>
            The flock took {shown.pigeonCrumbs} crumbs, {crumbsInUsdc(shown.pigeonCrumbs)} test USDC
          </figcaption>
        </figure>
      </div>
      {shown.topPigeons.length > 0 ? (
        <p className={styles.small}>
          Best beaks: {shown.topPigeons.map((pigeon) => `${pigeon.name} ${pigeon.crumbs}`).join(", ")}
        </p>
      ) : null}
      <p className={styles.body} style={{ fontSize: 20, fontWeight: 500 }}>
        {describeOwnLine(shown, crumbsInUsdc(shown.ownCrumbs))}
      </p>
      <div className={styles.actions}>
        <InkButton isPrimary keyHint="Enter" onPress={onAnteAgain}>
          Ante again
        </InkButton>
        <InkButton onPress={onCashOut}>Cash out</InkButton>
      </div>
    </PaperSheet>
  );
}
