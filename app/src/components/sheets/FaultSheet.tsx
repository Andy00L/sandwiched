"use client";

import { InkButton } from "./InkButton";
import { PaperSheet } from "./PaperSheet";
import styles from "./paper.module.css";
import { useLatestShown } from "./use-latest-shown";

export function FaultSheet({ reason }: { reason: string | null }) {
  const shown = useLatestShown(reason);
  return (
    <PaperSheet isOpen={reason !== null} size="half" seed={67} label="Something tore">
      <h2 className={styles.title}>Something tore.</h2>
      <p className={styles.body}>The game lost its place. A reload puts it back.</p>
      <p className={styles.small}>{shown}</p>
      <div className={styles.actions}>
        <InkButton isPrimary onPress={() => location.reload()}>
          Reload
        </InkButton>
      </div>
    </PaperSheet>
  );
}
