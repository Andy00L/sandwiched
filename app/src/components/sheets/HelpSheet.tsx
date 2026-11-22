"use client";

import { InkedPigeon, InkedWhale, PaperPlate } from "./CutPaperIcons";
import { InkButton } from "./InkButton";
import { PaperSheet } from "./PaperSheet";
import styles from "./paper.module.css";

const PANELS = [
  { line: "Everyone antes. One of you becomes the whale.", art: <InkedWhale size={84} /> },
  { line: "Pigeons peck the boxes. Only one has the sandwich.", art: <InkedPigeon size={84} /> },
  { line: "The whale slams. Watch the shadow.", art: <PaperPlate size={96} fill={0.4} kind="crumbs" /> },
];

export function HelpSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <PaperSheet isOpen={isOpen} size="full" seed={51} label="How to play">
      <h2 className={styles.title}>How lunch works</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
        {PANELS.map((panel) => (
          <figure key={panel.line} style={{ margin: 0, display: "grid", justifyItems: "start", gap: 6 }}>
            {panel.art}
            <figcaption className={styles.body}>{panel.line}</figcaption>
          </figure>
        ))}
      </div>
      <p className={styles.small}>A sandwich attack is when a bot takes a few cents from your trade. This is that, with birds.</p>
      <p className={styles.small}>
        Pigeon: click a lunchbox or press 1, 2, 3 to fly there, click it again or press space to peck, click the lawn or press W to take off. Whale: click a box or
        press 1, 2, 3 to slam it. H opens this page, Esc the settings.
      </p>
      <div className={styles.actions}>
        <InkButton keyHint="H" onPress={onClose}>
          Close
        </InkButton>
      </div>
    </PaperSheet>
  );
}
