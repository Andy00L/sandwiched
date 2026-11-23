"use client";

import { useSyncExternalStore } from "react";
import { InkButton } from "@/components/sheets/InkButton";
import { InkedPigeon } from "@/components/sheets/CutPaperIcons";
import { bootStore } from "@/lib/game/boot-state";
import styles from "./boot-curtain.module.css";

const PIGEON_SIZE_PX = 110;
const REASON_LIMIT_CHARS = 160;

export function BootCurtain() {
  const state = useSyncExternalStore(bootStore.subscribe, bootStore.getSnapshot, bootStore.getServerSnapshot);
  const isFailed = state.kind === "failed";
  return (
    <div className={styles.curtain} data-state={state.kind} role={isFailed ? "alert" : "status"} aria-hidden={state.kind === "ready"}>
      <div className={styles.stack}>
        <div className={styles.pigeon} data-pecking={!isFailed}>
          <InkedPigeon size={PIGEON_SIZE_PX} />
        </div>
        <h1 className={styles.title}>{isFailed ? "The table would not set." : "Setting the table"}</h1>
        {state.kind === "failed" ? (
          <>
            <p className={styles.reason}>{state.reason.slice(0, REASON_LIMIT_CHARS)}</p>
            <InkButton isPrimary onPress={() => location.reload()}>
              Reload
            </InkButton>
          </>
        ) : null}
      </div>
    </div>
  );
}
