"use client";

import type { Role } from "@/lib/game/play-flow";
import styles from "./paper.module.css";
import { useLatestShown } from "./use-latest-shown";

const HINTS: Record<Role, string> = {
  pigeon: "Click a lunchbox to fly there. Click it again to peck. Watch the shadow.",
  whale: "Click a box to slam it.",
};

export function HintLine({ role }: { role: Role | null }) {
  const shown = useLatestShown(role);
  return (
    <p className={styles.hint} data-shown={role !== null} aria-live="polite">
      {shown === null ? "" : HINTS[shown]}
    </p>
  );
}
