"use client";

import { useSyncExternalStore } from "react";
import type { PlayController } from "@/lib/game/play-controller";
import { readHintRole } from "@/lib/game/play-flow";
import { FaultSheet } from "./FaultSheet";
import { HelpSheet } from "./HelpSheet";
import { HintLine } from "./HintLine";
import { ReceiptSheet } from "./ReceiptSheet";
import { ResultsSheet } from "./ResultsSheet";
import { RoleSheet } from "./RoleSheet";
import { SeatSheet } from "./SeatSheet";
import { ShareSheet } from "./ShareSheet";
import { SettingsSheet } from "./SettingsSheet";
import styles from "./paper.module.css";

export function PlaySheets({ controller }: { controller: PlayController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { flow, drawer } = state;
  const overlay = flow.kind === "table" ? flow.overlay : null;
  return (
    <div className={styles.layer}>
      <SeatSheet flow={flow.kind === "seat" && drawer === null ? flow : null} onPlay={controller.playNow} onBack={controller.goHome} />
      <RoleSheet role={overlay?.kind === "role" && drawer === null ? overlay.role : null} />
      <ResultsSheet
        summary={overlay?.kind === "results" && drawer === null ? overlay.summary : null}
        table={flow.kind === "table" ? flow.table : null}
        onAnteAgain={controller.anteAgain}
        onShare={controller.openShare}
        onCashOut={controller.cashOut}
      />
      <ShareSheet
        shared={overlay?.kind === "share" && drawer === null ? { summary: overlay.summary, frame: overlay.frame } : null}
        table={flow.kind === "table" ? flow.table : null}
        onClose={controller.closeShare}
      />
      <ReceiptSheet
        receipt={overlay?.kind === "receipt" && drawer === null ? overlay.receipt : null}
        isCashingOut={overlay?.kind === "cashingOut" && drawer === null}
        onRetry={controller.cashOut}
      />
      <HelpSheet isOpen={drawer === "help"} onClose={controller.closeDrawer} />
      <SettingsSheet isOpen={drawer === "settings"} onClose={controller.closeDrawer} />
      <FaultSheet reason={flow.kind === "fault" ? flow.reason : null} />
      <HintLine role={readHintRole(state)} />
    </div>
  );
}
