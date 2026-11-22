"use client";

import type { ReactNode } from "react";
import styles from "./paper.module.css";

export type InkButtonProps = {
  onPress: () => void;
  isPrimary?: boolean;
  disabledReason?: string | null;
  keyHint?: string;
  children: ReactNode;
};

export function InkButton({ onPress, isPrimary = false, disabledReason = null, keyHint, children }: InkButtonProps) {
  return (
    <button
      type="button"
      className={styles.button}
      data-primary={isPrimary}
      disabled={disabledReason !== null}
      title={disabledReason ?? undefined}
      aria-keyshortcuts={keyHint}
      onClick={onPress}
    >
      <span className={styles.tab}>{children}</span>
    </button>
  );
}
