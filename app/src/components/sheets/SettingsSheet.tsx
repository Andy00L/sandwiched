"use client";

import { useState } from "react";
import { AUDIO_BUSES, readAudioLevels } from "@/lib/audio/audio-levels";
import { changeAudioLevels } from "@/lib/audio/game-audio";
import { type AudioBus, type AudioLevels, DEFAULT_LEVELS } from "@/lib/audio/mix";
import { QUALITY_CHOICES, type QualityChoice, readQualityChoice, storeQualityChoice } from "@/lib/table/stage/quality-probe";
import { InkButton } from "./InkButton";
import { PaperSheet } from "./PaperSheet";
import styles from "./paper.module.css";

const QUALITY_WORDS: Record<QualityChoice, string> = { high: "High", medium: "Medium", low: "Low", auto: "Auto" };
const BUS_WORDS: Record<AudioBus, string> = { music: "Music", sounds: "Sounds", voices: "Voices" };
const LEVEL_STEPS = 100;

export function SettingsSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [chosen, setChosen] = useState<QualityChoice | null>(null);
  const [initial] = useState<QualityChoice>(() => (typeof window === "undefined" ? "auto" : readQualityChoice()));
  const current = chosen ?? initial;
  const choose = (choice: QualityChoice) => {
    storeQualityChoice(choice);
    setChosen(choice);
  };
  const [levels, setLevels] = useState<AudioLevels>(() => (typeof window === "undefined" ? DEFAULT_LEVELS : readAudioLevels()));
  const changeLevel = (bus: AudioBus, level: number) => {
    const next = { ...levels, [bus]: level };
    setLevels(next);
    changeAudioLevels(next);
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
      <p className={styles.label}>Sound</p>
      {AUDIO_BUSES.map((bus) => (
        <label key={bus} className={styles.small} style={{ display: "grid", gridTemplateColumns: "5.5em 1fr", alignItems: "center", gap: 12 }}>
          {BUS_WORDS[bus]}
          <input
            type="range"
            min={0}
            max={LEVEL_STEPS}
            value={Math.round(levels[bus] * LEVEL_STEPS)}
            onChange={(event) => changeLevel(bus, Number(event.currentTarget.value) / LEVEL_STEPS)}
            style={{ accentColor: "var(--ink)" }}
          />
        </label>
      ))}
      <p className={styles.small}>M mutes and unmutes every sound.</p>
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
