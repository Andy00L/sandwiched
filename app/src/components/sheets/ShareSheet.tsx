"use client";

import Image from "next/image";
import { useMemo } from "react";
import { CHIPS_PER_ANTE } from "@/lib/game/chain-rules";
import { formatUsdc } from "@/lib/game/game-session";
import { type RoundSummary, chooseRoundTitle } from "@/lib/game/play-flow";
import type { TableListing } from "@/lib/game/table-listings";
import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH, drawShareCard } from "@/lib/ui/share-card";
import { InkButton } from "./InkButton";
import { PaperSheet } from "./PaperSheet";
import styles from "./paper.module.css";
import { useLatestShown } from "./use-latest-shown";

export type SharedRound = { summary: RoundSummary; frame: HTMLCanvasElement | null };

export type ShareSheetProps = { shared: SharedRound | null; table: TableListing | null; onClose: () => void };

const X_INTENT_URL = "https://x.com/intent/post";

const describeShareLine = (summary: RoundSummary, usdc: string): string => {
  if (summary.ownRole === "whale") return `I was the whale and kept ${usdc} test USDC of my lunch.`;
  return summary.ownCrumbs === 0 ? "I pecked zero crumbs off a whale. The whale is fine." : `I pecked ${usdc} test USDC off a whale.`;
};

export function ShareSheet({ shared, table, onClose }: ShareSheetProps) {
  const shown = useLatestShown(shared);
  const shownTable = useLatestShown(table);
  const card = useMemo(() => {
    if (shown === null || shownTable === null) return null;
    const usdc = formatUsdc(BigInt(shown.summary.ownCrumbs) * (shownTable.anteUnits / BigInt(CHIPS_PER_ANTE)));
    const line = describeShareLine(shown.summary, usdc);
    const image = drawShareCard(shown.frame, { title: chooseRoundTitle(shown.summary), line, tableAddress: shown.summary.tableAddress });
    return { imageUrl: image.toDataURL("image/png"), postText: `${line} Every crumb was an on-chain transaction.`, roundNumber: shown.summary.roundNumber };
  }, [shown, shownTable]);
  const postOnX = () => {
    if (card === null) return;
    const query = new URLSearchParams({ text: card.postText, url: location.origin });
    window.open(`${X_INTENT_URL}?${query.toString()}`, "_blank", "noopener,noreferrer");
  };
  return (
    <PaperSheet isOpen={shared !== null} size="full" seed={83} label="Share">
      <p className={styles.label}>Share the round</p>
      {card === null ? null : (
        <Image
          src={card.imageUrl}
          unoptimized
          width={SHARE_CARD_WIDTH}
          height={SHARE_CARD_HEIGHT}
          alt="A paper postcard of the round with its title and your line"
          style={{ width: "100%", maxWidth: 560, height: "auto", display: "block" }}
        />
      )}
      <div className={styles.actions}>
        <InkButton isPrimary onPress={postOnX}>
          Post on X
        </InkButton>
        {card === null ? null : (
          <a className={styles.link} href={card.imageUrl} download={`sandwich-round-${card.roundNumber}.png`}>
            Save the card
          </a>
        )}
        <button type="button" className={styles.link} onClick={onClose}>
          Back
        </button>
      </div>
    </PaperSheet>
  );
}
