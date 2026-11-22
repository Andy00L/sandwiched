import { cpSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type ScratchBreak = { name: string; file: string; find: string; replace: string; breaks: string };

type BreakOutcome = { name: string; outcome: "caught" | "missed" | "stale"; detail: string };

const APP_ROOT = resolve(import.meta.dir, "../../app");
const MUTANTS_ROOT = join(import.meta.dir, ".mutants");
const COPIED_PATHS = ["src/lib/game", "src/lib/chain", "tests", "tsconfig.json"] as const;
const CHECK_FILE = "src/lib/game/table-store.check.test.ts";
const PROPERTY_FILTER = "agrees with the chain";
const DETAIL_LENGTH = 400;

const SCRATCH_BREAKS: readonly ScratchBreak[] = [
  {
    name: "swats-collapse",
    file: "src/lib/game/snapshot-diff.ts",
    find: ".filter((swat) => Number(swat.number) > knownSwatCount)",
    replace: ".filter((swat) => swat.number === table.round.swatCount && Number(swat.number) > knownSwatCount)",
    breaks: "a diff that carries two new swats raises only the newest (the audit's collapsed swats)",
  },
  {
    name: "prediction-outlives-round",
    file: "src/lib/game/table-store.ts",
    find: "keepPredictions((prediction) => prediction.roundNumber === liveRoundNumber && prediction.expiresTick >= chainTick)",
    replace: "keepPredictions((prediction) => prediction.expiresTick >= chainTick)",
    breaks: "predictions are kept until they time out, whatever round they were made in",
  },
  {
    name: "slot-regression-freezes",
    file: "src/lib/game/table-store.ts",
    find: "if (lastSlot - change.slot <= SLOT_REGRESSION_SLOTS) return;",
    replace: "if (lastSlot - change.slot <= Number.MAX_SAFE_INTEGER) return;",
    breaks: "every change below the last slot seen is dropped, so a restarted rollup is never followed",
  },
  {
    name: "same-slot-split",
    file: "src/lib/game/table-store.ts",
    find: "      if (dueChanges[index + 1]?.slot === change.slot) return;\n",
    replace: "",
    breaks: "changes that share a slot are applied as separate frames",
  },
  {
    name: "hold-buffer-off",
    file: "src/lib/game/table-store.ts",
    find: "const DEFAULT_HORIZON_TICKS = 10;",
    replace: "const DEFAULT_HORIZON_TICKS = 0;",
    breaks: "the 100 ms hold buffer is gone, so changes apply the moment they arrive",
  },
  {
    name: "settle-reads-old-seats",
    file: "src/lib/game/table-store.ts",
    find: "table: settledTable, seats: seatsAtSettle }",
    replace: "table: settledTable, seats: applied.seats }",
    breaks: "a settle that shares a frame with the next round's ante reads the seats from before the settle (finding 1)",
  },
  {
    name: "next-ante-kept-in-beak",
    file: "src/lib/game/table-store.ts",
    find: "chips: seat.chips + BigInt(CHIPS_PER_ANTE) }",
    replace: "chips: seat.chips }",
    breaks: "a seat that antes into the next round in the settle's frame has the ante taken off its beak (finding 1)",
  },
  {
    name: "previous-round-dropped",
    file: "src/lib/game/table-store.ts",
    find: "      previous: previousRound,",
    replace: "      previous: null,",
    breaks: "the snapshot forgets the round that just ended once the next one starts in the same advance (finding 1)",
  },
  {
    name: "settle-hold-off",
    file: "src/lib/game/table-store.ts",
    find: "const settleHoldTick = findSettleHoldTick();",
    replace: "const settleHoldTick = null;",
    breaks: "a settle is applied before the seat snapshots it wrote arrive (finding 2)",
  },
  {
    name: "settle-raises-skipped",
    file: "src/lib/game/snapshot-diff.ts",
    find: 'if (table.phase.state !== "live" && !isSettlement(previousTable, table)) return [];',
    replace: 'if (table.phase.state !== "live") return [];',
    breaks: "a swat raised in the same poll as the settle is never raised (finding 3)",
  },
];

function countOccurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

function prepareMutant(scratchBreak: ScratchBreak): { ok: true; root: string } | { ok: false; reason: string } {
  const root = join(MUTANTS_ROOT, scratchBreak.name);
  rmSync(root, { recursive: true, force: true });
  for (const copiedPath of COPIED_PATHS) cpSync(join(APP_ROOT, copiedPath), join(root, copiedPath), { recursive: true });
  symlinkSync(join(APP_ROOT, "node_modules"), join(root, "node_modules"));
  const target = join(root, scratchBreak.file);
  const source = readFileSync(target, "utf8");
  if (countOccurrences(source, scratchBreak.find) !== 1) return { ok: false, reason: `${scratchBreak.file} no longer contains the edited text exactly once` };
  writeFileSync(target, source.replace(scratchBreak.find, scratchBreak.replace));
  return { ok: true, root };
}

async function runScratchBreak(scratchBreak: ScratchBreak): Promise<BreakOutcome> {
  const prepared = prepareMutant(scratchBreak);
  if (!prepared.ok) {
    rmSync(join(MUTANTS_ROOT, scratchBreak.name), { recursive: true, force: true });
    return { name: scratchBreak.name, outcome: "stale", detail: prepared.reason };
  }
  const child = Bun.spawn(["bun", "test", CHECK_FILE, "-t", PROPERTY_FILTER], { cwd: prepared.root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  rmSync(prepared.root, { recursive: true, force: true });
  const lines = `${stdout}\n${stderr}`.split("\n");
  const firstFault = lines.find((line) => line.includes("[checkSession]")) ?? lines.find((line) => line.includes("(fail)")) ?? "";
  return exitCode === 0
    ? { name: scratchBreak.name, outcome: "missed", detail: "every property test still passed" }
    : { name: scratchBreak.name, outcome: "caught", detail: firstFault.trim().slice(0, DETAIL_LENGTH) };
}

async function runAllScratchBreaks(): Promise<number> {
  const outcomes = await Promise.all(SCRATCH_BREAKS.map(runScratchBreak));
  rmSync(MUTANTS_ROOT, { recursive: true, force: true });
  for (const [index, outcome] of outcomes.entries()) {
    console.log(`[runAllScratchBreaks] ${outcome.name}: ${outcome.outcome} (${SCRATCH_BREAKS[index]?.breaks ?? ""})`);
    console.log(`[runAllScratchBreaks]   ${outcome.detail}`);
  }
  return outcomes.every((outcome) => outcome.outcome === "caught") ? 0 : 1;
}

process.exit(await runAllScratchBreaks());
