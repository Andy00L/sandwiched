"use client";

import { type ReactNode, useMemo } from "react";
import { SCISSOR_CUT, buildDeckledClipPath, buildFrameTicksPath, buildInkedFramePath } from "@/lib/ui/paper-edges";
import styles from "./paper.module.css";

export type SheetSize = "full" | "half";

const ASPECT_BY_SIZE: Record<SheetSize, number> = { full: 1.9, half: 2.6 };
const NEATLINE_INSET = 2.4;
const INNER_RULE_INSET = 3.6;
const TICK_LENGTH = 0.9;

export type PaperSheetProps = { isOpen: boolean; size: SheetSize; seed: number; label: string; children: ReactNode };

export function PaperSheet({ isOpen, size, seed, label, children }: PaperSheetProps) {
  const clipPath = useMemo(() => buildDeckledClipPath(seed, ASPECT_BY_SIZE[size], SCISSOR_CUT), [seed, size]);
  const neatline = useMemo(() => buildInkedFramePath(seed, NEATLINE_INSET, 0.35), [seed]);
  const innerRule = useMemo(() => buildInkedFramePath(seed + 1, INNER_RULE_INSET, 0.25), [seed]);
  const ticks = useMemo(() => buildFrameTicksPath(NEATLINE_INSET, TICK_LENGTH), []);
  return (
    <section className={styles.slot} data-size={size} aria-hidden={!isOpen}>
      <div className={styles.sheet} data-open={isOpen} inert={!isOpen} role="dialog" aria-label={label}>
        <div className={styles.face} style={{ clipPath }}>
          <svg className={styles.frame} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path className={styles.neatline} d={neatline} />
            <path className={styles.innerRule} d={innerRule} />
            <path className={styles.ticks} d={ticks} />
          </svg>
          <div className={styles.content}>{children}</div>
        </div>
      </div>
    </section>
  );
}
