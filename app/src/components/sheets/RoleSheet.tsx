"use client";

import type { Role } from "@/lib/game/play-flow";
import { InkedPigeon, InkedWhale } from "./CutPaperIcons";
import { PaperSheet } from "./PaperSheet";
import styles from "./paper.module.css";
import { useLatestShown } from "./use-latest-shown";

const ROLE_LINES: Record<Role, string> = { whale: "You are the whale. Protect your lunch.", pigeon: "You are a pigeon. Go eat." };

export function RoleSheet({ role }: { role: Role | null }) {
  const shown = useLatestShown(role) ?? "pigeon";
  return (
    <PaperSheet isOpen={role !== null} size="half" seed={23} label="Your role">
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {shown === "whale" ? <InkedWhale size={96} /> : <InkedPigeon size={96} />}
        <h2 className={styles.title}>{ROLE_LINES[shown]}</h2>
      </div>
    </PaperSheet>
  );
}
