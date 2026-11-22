"use client";

import { useState } from "react";
import { QUALITY_CHOICES, type QualityChoice, readQualityChoice, storeQualityChoice } from "@/lib/table/stage/quality-probe";
import { InkButton } from "./InkButton";
import { PaperSheet } from "./PaperSheet";
import styles from "./paper.module.css";

const QUALITY_WORDS: Record<QualityChoice, string> = { high: "High", medium: "Medium", low: "Low", auto: "Auto" };

export function SettingsSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [chosen, setChosen] = useState<QualityChoice | null>(null);
  const [initial] = useState<QualityChoice>(() => (typeof window === "undefined" ? "auto" : readQualityChoice()));
  const current = chosen ?? initial;
  const choose = (choice: QualityChoice) => {
    storeQualityChoice(choice);
    setChosen(choice);
  };
  return (
    <PaperSheet isOpen={isOpen} size="half" seed={59} label="Settings">
      <h2 className={styles.title}>Settings</h2>
      <p className={styles.label}>Picture quality</p>
      <div className={styles.actions} role="radiogroup" aria-label="Picture quality">
        {QUALITY_CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={choice === current}
            className={styles.link}
            style={{ fontWeight: choice === current ? 700 : 400, textDecoration: choice === current ? "underline" : "none" }}
            onClick={() => choose(choice)}
          >
            {QUALITY_WORDS[choice]}
          </button>
        ))}
      </div>
      <p className={styles.small}>{chosen === null ? "Auto measures your screen and picks for you." : "Takes effect when the page reloads."}</p>
      <div className={styles.actions}>
        {chosen === null ? null : (
          <InkButton isPrimary onPress={() => location.reload()}>
            Reload
          </InkButton>
        )}
        <InkButton keyHint="Escape" onPress={onClose}>
          Close
        </InkButton>
      </div>
    </PaperSheet>
  );
}
