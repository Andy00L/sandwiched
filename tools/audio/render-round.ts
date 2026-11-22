import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseRecordedRound } from "../../app/src/lib/game/round-events";
import type { RecordedRound } from "../../app/src/lib/game/round-events";
import { REVEAL_LID_STAGGER_S, WHISTLE_S } from "../../app/src/lib/table/motion/motion-tokens";
import { gainToDb } from "../../app/src/lib/audio/mix";
import { OFFLINE_SAMPLE_RATE, renderPlanOffline } from "../../app/src/lib/audio/offline-mix";
import type { MixLabel, OfflinePlan, OfflineVoices, StereoBuffer } from "../../app/src/lib/audio/offline-mix";
import { planRoundOffline } from "../../app/src/lib/audio/offline-round";
import { VOICE_FILES } from "../../app/src/lib/audio/voice-files.generated";
import { VOICE_NEEDS } from "../../app/src/lib/audio/voices";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const OUTPUT_DIR = path.join(REPO_ROOT, "app/.scratch/audio");
const DEFAULT_ROUND = path.join(REPO_ROOT, "app/tests/rounds/slam-showcase.json");
const DEFAULT_OWN_SEATS = [1, 9];
const TOLERANCE_DB = 2;
const CLIP_CEILING_DBFS = -1;
const WINDOW_S = 1;

type Result<Value> = { ok: true; value: Value } | { ok: false; reason: string };

type LevelTarget = { name: string; labels: readonly MixLabel[]; lowestDbfs: number; highestDbfs: number };

const LEVEL_TARGETS: readonly LevelTarget[] = [
  { name: "Piano bass", labels: ["bass"], lowestDbfs: -8.5, highestDbfs: -8.5 },
  { name: "Piano melody", labels: ["melody"], lowestDbfs: -14, highestDbfs: -10 },
  { name: "Reward notes", labels: ["reward"], lowestDbfs: -14, highestDbfs: -10 },
  { name: "The slam (flap plus thump)", labels: ["slam"], lowestDbfs: -12, highestDbfs: -12 },
  { name: "Voices", labels: ["voice"], lowestDbfs: -18, highestDbfs: -16 },
  { name: "Rising flaps", labels: ["risingFlap"], lowestDbfs: -19, highestDbfs: -19 },
  { name: "Closing flaps", labels: ["closingFlap"], lowestDbfs: -28, highestDbfs: -28 },
  { name: "Peck ticks, crumb patter, timer", labels: ["tick"], lowestDbfs: -30, highestDbfs: -30 },
  { name: "Landings", labels: ["landing"], lowestDbfs: -38, highestDbfs: -35 },
];

async function decodeVoice(url: string): Promise<Result<Float32Array<ArrayBuffer>>> {
  const file = path.join(REPO_ROOT, "app/public", url);
  const child = Bun.spawn(["ffmpeg", "-v", "error", "-i", file, "-f", "f32le", "-ac", "1", "-ar", String(OFFLINE_SAMPLE_RATE), "-"], { stdout: "pipe", stderr: "pipe" });
  const [bytes, stderr, exitCode] = await Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) return { ok: false, reason: `[decodeVoice] ${file}: ${stderr.trim()}` };
  return { ok: true, value: new Float32Array(bytes) };
}

async function decodeVoices(): Promise<Result<OfflineVoices>> {
  const voices = new Map<string, Float32Array<ArrayBuffer>>();
  for (const file of VOICE_FILES) {
    const decoded = await decodeVoice(file.url);
    if (!decoded.ok) return decoded;
    voices.set(file.id, decoded.value);
  }
  return { ok: true, value: voices };
}

function measurePeak(buffer: StereoBuffer): { peakDbfs: number; clippedSamples: number; overCeilingSamples: number } {
  let peak = 0;
  let clippedSamples = 0;
  let overCeilingSamples = 0;
  const ceiling = Math.pow(10, CLIP_CEILING_DBFS / 20);
  for (const channel of [buffer.left, buffer.right]) {
    for (const sample of channel) {
      const magnitude = Math.abs(sample);
      peak = Math.max(peak, magnitude);
      if (magnitude >= 1) clippedSamples++;
      if (magnitude > ceiling) overCeilingSamples++;
    }
  }
  return { peakDbfs: gainToDb(peak), clippedSamples, overCeilingSamples };
}

function writeWav(file: string, buffer: StereoBuffer): void {
  const frames = buffer.left.length;
  const data = Buffer.alloc(44 + frames * 4);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + frames * 4, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(2, 22);
  data.writeUInt32LE(buffer.sampleRate, 24);
  data.writeUInt32LE(buffer.sampleRate * 4, 28);
  data.writeUInt16LE(4, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(frames * 4, 40);
  const toInt16 = (sample: number) => Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
  for (let frame = 0; frame < frames; frame++) {
    data.writeInt16LE(toInt16(buffer.left[frame] ?? 0), 44 + frame * 4);
    data.writeInt16LE(toInt16(buffer.right[frame] ?? 0), 46 + frame * 4);
  }
  writeFileSync(file, data);
}

async function measureLoudness(file: string): Promise<string> {
  const child = Bun.spawn(["ffmpeg", "-hide_banner", "-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"], { stdout: "pipe", stderr: "pipe" });
  const [stderr] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  return /I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1] ?? "unknown";
}

function maxInWindow(times: readonly number[]): number {
  const sorted = [...times].sort((first, second) => first - second);
  let best = 0;
  let windowStart = 0;
  for (let index = 0; index < sorted.length; index++) {
    while ((sorted[windowStart] ?? 0) <= (sorted[index] ?? 0) - WINDOW_S) windowStart++;
    best = Math.max(best, index - windowStart + 1);
  }
  return best;
}

function describeDensity(plan: OfflinePlan, round: RecordedRound): string {
  const settled = round.events.find((event) => event.kind === "settled");
  const revealFromS = settled === undefined ? Number.POSITIVE_INFINITY : (settled.tick * round.tickMs) / 1000 + WHISTLE_S - 0.01;
  const revealUntilS = revealFromS + (round.boxCount - 1) * REVEAL_LID_STAGGER_S + 0.05;
  const flapTimes: number[] = [];
  const tickTimes: number[] = [];
  for (const sound of plan.sounds) {
    if (sound.kind !== "paper" || sound.recipe.kind !== "flap") continue;
    const isTick = sound.recipe.tone === "tick" || sound.recipe.tone === "timer";
    if (isTick) tickTimes.push(sound.atS);
    else if (sound.atS < revealFromS || sound.atS > revealUntilS) flapTimes.push(sound.atS);
  }
  const drawn = round.events.find((event) => event.kind === "whaleDrawn");
  const liveFromS = drawn === undefined ? 0 : (drawn.tick * round.tickMs) / 1000;
  const liveS = Math.max(1, revealFromS - liveFromS);
  const liveFlaps = flapTimes.filter((atS) => atS >= liveFromS && atS < revealFromS).length;
  return [
    `flaps outside the reveal: ${flapTimes.length}, at most ${maxInWindow(flapTimes)} in any 1 s, ${(liveFlaps / liveS).toFixed(2)} per second over the live round`,
    `peck ticks, patter and timer ticks: ${tickTimes.length}, at most ${maxInWindow(tickTimes)} in any 1 s`,
  ].join("\n");
}

function verdict(target: LevelTarget, peakDbfs: number): string {
  if (!Number.isFinite(peakDbfs) || peakDbfs < -200) return "absent";
  const isInside = peakDbfs >= target.lowestDbfs - TOLERANCE_DB && peakDbfs <= target.highestDbfs + TOLERANCE_DB;
  return isInside ? "within 2 dB" : "OUTSIDE";
}

function describeTarget(target: LevelTarget): string {
  return target.lowestDbfs === target.highestDbfs ? `${target.lowestDbfs}` : `${target.lowestDbfs} to ${target.highestDbfs}`;
}

async function renderForSeat(round: RecordedRound, roundName: string, ownSeat: number, voices: OfflineVoices): Promise<boolean> {
  const plan = planRoundOffline(round, { files: VOICE_FILES, ownSeat });
  const mix = renderPlanOffline(plan, voices);
  const mixFile = path.join(OUTPUT_DIR, `${roundName}-own-seat-${ownSeat}.wav`);
  writeWav(mixFile, mix);
  const mixPeak = measurePeak(mix);
  console.info(`[renderForSeat] ${roundName}, own seat ${ownSeat}${ownSeat === round.events.find((event) => event.kind === "whaleDrawn")?.whaleSeat ? " (the whale)" : ""}: ${mixFile}`);
  console.info(`[renderForSeat] mix peak ${mixPeak.peakDbfs.toFixed(1)} dBFS, ${mixPeak.clippedSamples} clipped samples, ${mixPeak.overCeilingSamples} samples above ${CLIP_CEILING_DBFS} dBFS, ${await measureLoudness(mixFile)} LUFS integrated`);
  console.info(`[renderForSeat] ${describeDensity(plan, round).replaceAll("\n", "\n[renderForSeat] ")}`);
  console.info("[renderForSeat] | Source | Target dBFS | Measured peak dBFS | Verdict |");
  let isAllInside = true;
  for (const target of LEVEL_TARGETS) {
    const stem = renderPlanOffline(plan, voices, (label) => target.labels.includes(label));
    const { peakDbfs } = measurePeak(stem);
    const result = verdict(target, peakDbfs);
    if (result === "OUTSIDE") isAllInside = false;
    console.info(`[renderForSeat] | ${target.name} | ${describeTarget(target)} | ${peakDbfs < -200 ? "none" : peakDbfs.toFixed(1)} | ${result} |`);
  }
  const voiceRows: string[] = [];
  for (const need of VOICE_NEEDS) {
    const needPlan: OfflinePlan = { ...plan, sounds: plan.sounds.filter((sound) => sound.kind !== "voice" || sound.play.file.need === need) };
    const plays = needPlan.sounds.filter((sound) => sound.kind === "voice").length;
    if (plays === 0) {
      voiceRows.push(`${need} 0 plays`);
      continue;
    }
    const { peakDbfs } = measurePeak(renderPlanOffline(needPlan, voices, (label) => label === "voice"));
    voiceRows.push(`${need} ${plays} plays peak ${peakDbfs.toFixed(1)}`);
  }
  console.info(`[renderForSeat] voices by need: ${voiceRows.join("; ")}`);
  return isAllInside && mixPeak.clippedSamples === 0;
}

async function main(): Promise<number> {
  const roundPath = process.argv[2] ?? DEFAULT_ROUND;
  const ownSeats = process.argv[3] === undefined ? DEFAULT_OWN_SEATS : process.argv[3].split(",").map(Number);
  const parsed = parseRecordedRound(JSON.parse(readFileSync(roundPath, "utf8")));
  if (!parsed.ok) {
    console.error(`[main] ${parsed.reason}`);
    return 1;
  }
  const voices = await decodeVoices();
  if (!voices.ok) {
    console.error(`[main] ${voices.reason}`);
    return 1;
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const roundName = path.basename(roundPath, ".json");
  let isClean = true;
  for (const ownSeat of ownSeats) isClean = (await renderForSeat(parsed.round, roundName, ownSeat, voices.value)) && isClean;
  return isClean ? 0 : 1;
}

process.exit(await main());
