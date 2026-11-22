import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const SOURCES_PATH = path.join(import.meta.dir, "voice-sources.json");
const WORK_DIR = path.join(REPO_ROOT, ".scratch", "audio-build");
const GENERATED_TS_PATH = path.join(REPO_ROOT, "app/src/lib/audio/voice-files.generated.ts");
const CREDITS_PATH = path.join(REPO_ROOT, "docs/credits.md");
const ALLOWED_LICENCES = [/^Creative Commons 0 \(/, /^CC0 \(/, /^Public domain$/];
const TRIM_BELOW_PEAK_DB = 40;
const FADE_IN_S = 0.005;
const FADE_OUT_S = 0.03;
const LOUDNESS_PAD_S = 1;
const BYTES_PER_KB = 1024;

type Result<Value> = { ok: true; value: Value } | { ok: false; reason: string };

type VoiceSource = {
  id: string;
  need: string;
  what: string;
  input: string;
  startS: number;
  lengthS: number;
  semitones: number;
  keepLength: boolean;
  sourcePage: string;
  directUrl: string;
  title: string;
  author: string;
  licence: string;
};

type SourceList = {
  candidatesDir: string;
  outputDir: string;
  publicPrefix: string;
  budgetKb: number;
  targetLufs: number;
  peakCeilingDbfs: number;
  lowpassHz: number;
  bitrateKbps: number;
  sampleRate: number;
  files: VoiceSource[];
};

type BuiltVoice = { source: VoiceSource; fileName: string; bytes: number; durationS: number; peakDbfs: number; loudnessLufs: number; gainDb: number };

type Loudness = { integratedLufs: number; samplePeakDbfs: number };

const succeed = <Value>(value: Value): Result<Value> => ({ ok: true, value });
const fail = <Value>(reason: string): Result<Value> => ({ ok: false, reason });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(record: Record<string, unknown>, key: string, where: string): Result<string> {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? succeed(value) : fail(`${where}.${key} must be a non-empty string`);
}

function readNumber(record: Record<string, unknown>, key: string, where: string): Result<number> {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? succeed(value) : fail(`${where}.${key} must be a number`);
}

function parseVoiceSource(value: unknown, where: string): Result<VoiceSource> {
  if (!isRecord(value)) return fail(`${where} must be an object`);
  const texts = ["id", "need", "what", "input", "sourcePage", "directUrl", "title", "author", "licence"] as const;
  const numbers = ["startS", "lengthS", "semitones"] as const;
  const readTexts = texts.map((key) => readText(value, key, where));
  const readNumbers = numbers.map((key) => readNumber(value, key, where));
  const problem = [...readTexts, ...readNumbers].find((field) => !field.ok);
  if (problem && !problem.ok) return fail(problem.reason);
  if (typeof value.keepLength !== "boolean") return fail(`${where}.keepLength must be true or false`);
  const text = (key: (typeof texts)[number]) => String(value[key]);
  const number = (key: (typeof numbers)[number]) => Number(value[key]);
  const licence = text("licence");
  if (!ALLOWED_LICENCES.some((pattern) => pattern.test(licence))) return fail(`${where}.licence "${licence}" is not CC0 or public domain`);
  if (number("lengthS") <= 0) return fail(`${where}.lengthS must be above 0`);
  return succeed({
    id: text("id"),
    need: text("need"),
    what: text("what"),
    input: text("input"),
    startS: number("startS"),
    lengthS: number("lengthS"),
    semitones: number("semitones"),
    keepLength: value.keepLength,
    sourcePage: text("sourcePage"),
    directUrl: text("directUrl"),
    title: text("title"),
    author: text("author"),
    licence,
  });
}

function parseSourceList(json: unknown): Result<SourceList> {
  if (!isRecord(json)) return fail("the source list must be an object");
  const texts = ["candidatesDir", "outputDir", "publicPrefix"] as const;
  const numbers = ["budgetKb", "targetLufs", "peakCeilingDbfs", "lowpassHz", "bitrateKbps", "sampleRate"] as const;
  const problem = [...texts.map((key) => readText(json, key, "list")), ...numbers.map((key) => readNumber(json, key, "list"))].find((field) => !field.ok);
  if (problem && !problem.ok) return fail(problem.reason);
  if (!Array.isArray(json.files) || json.files.length === 0) return fail("list.files must be a non-empty list");
  const files: VoiceSource[] = [];
  for (const [index, entry] of json.files.entries()) {
    const parsed = parseVoiceSource(entry, `list.files[${index}]`);
    if (!parsed.ok) return fail(parsed.reason);
    files.push(parsed.value);
  }
  const ids = new Set(files.map((file) => file.id));
  if (ids.size !== files.length) return fail("list.files has an id twice");
  return succeed({
    candidatesDir: String(json.candidatesDir),
    outputDir: String(json.outputDir),
    publicPrefix: String(json.publicPrefix),
    budgetKb: Number(json.budgetKb),
    targetLufs: Number(json.targetLufs),
    peakCeilingDbfs: Number(json.peakCeilingDbfs),
    lowpassHz: Number(json.lowpassHz),
    bitrateKbps: Number(json.bitrateKbps),
    sampleRate: Number(json.sampleRate),
    files,
  });
}

async function runCommand(command: readonly string[]): Promise<Result<string>> {
  const child = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) return fail(`${command[0]} exited ${exitCode}: ${stderr.trim().slice(-600)}`);
  return succeed(`${stdout}\n${stderr}`);
}

async function hasRubberband(): Promise<boolean> {
  const listed = await runCommand(["ffmpeg", "-hide_banner", "-filters"]);
  return listed.ok && /\brubberband\b/.test(listed.value);
}

async function measureMaxVolumeDb(file: string): Promise<Result<number>> {
  const measured = await runCommand(["ffmpeg", "-hide_banner", "-nostats", "-i", file, "-af", "volumedetect", "-f", "null", "-"]);
  if (!measured.ok) return measured;
  const match = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(measured.value);
  if (match?.[1] === undefined) return fail(`no max_volume in the volumedetect output for ${file}`);
  return succeed(match[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(match[1]));
}

async function measureLoudness(file: string): Promise<Result<Loudness>> {
  const filter = `apad=pad_dur=${LOUDNESS_PAD_S},ebur128=peak=sample`;
  const measured = await runCommand(["ffmpeg", "-hide_banner", "-nostats", "-i", file, "-af", filter, "-f", "null", "-"]);
  if (!measured.ok) return measured;
  const summary = measured.value.slice(measured.value.lastIndexOf("Summary:"));
  const integrated = /I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1];
  const peak = /Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary)?.[1];
  if (integrated === undefined || peak === undefined) return fail(`no loudness summary for ${file}`);
  return succeed({ integratedLufs: Number(integrated), samplePeakDbfs: peak === "-inf" ? Number.NEGATIVE_INFINITY : Number(peak) });
}

async function measureDurationS(file: string): Promise<Result<number>> {
  const probed = await runCommand(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  if (!probed.ok) return probed;
  const duration = Number(probed.value.trim().split("\n")[0]);
  return Number.isFinite(duration) && duration > 0 ? succeed(duration) : fail(`ffprobe gave no duration for ${file}`);
}

function describeShapingFilter(source: VoiceSource, list: SourceList): string {
  const steps = [
    `atrim=start=${source.startS}:duration=${source.lengthS}`,
    "asetpts=PTS-STARTPTS",
    "aformat=channel_layouts=mono",
    `aresample=${list.sampleRate}`,
  ];
  if (source.semitones !== 0) steps.push(`rubberband=pitch=${Math.pow(2, source.semitones / 12).toFixed(6)}`);
  steps.push(`lowpass=f=${list.lowpassHz}`, `lowpass=f=${list.lowpassHz}`);
  return steps.join(",");
}

function describeTrimFilter(thresholdDb: number): string {
  const trimStart = `silenceremove=start_periods=1:start_threshold=${thresholdDb.toFixed(1)}dB:start_silence=0.005`;
  return [trimStart, "areverse", trimStart, "areverse"].join(",");
}

async function buildVoice(source: VoiceSource, list: SourceList): Promise<Result<BuiltVoice>> {
  const inputPath = path.join(REPO_ROOT, list.candidatesDir, source.input);
  if (!existsSync(inputPath)) return fail(`[buildVoice] ${source.id}: input ${inputPath} is missing (download it from ${source.directUrl})`);
  const shapedPath = path.join(WORK_DIR, `${source.id}.shaped.wav`);
  const trimmedPath = path.join(WORK_DIR, `${source.id}.trimmed.wav`);
  const fileName = `${source.id}.ogg`;
  const outputPath = path.join(REPO_ROOT, list.outputDir, fileName);
  const shaped = await runCommand(["ffmpeg", "-y", "-v", "error", "-i", inputPath, "-af", describeShapingFilter(source, list), "-c:a", "pcm_f32le", shapedPath]);
  if (!shaped.ok) return fail(`[buildVoice] ${source.id}: ${shaped.reason}`);
  if (source.keepLength) {
    const copied = await runCommand(["ffmpeg", "-y", "-v", "error", "-i", shapedPath, "-c:a", "pcm_f32le", trimmedPath]);
    if (!copied.ok) return fail(`[buildVoice] ${source.id}: ${copied.reason}`);
  } else {
    const maxVolume = await measureMaxVolumeDb(shapedPath);
    if (!maxVolume.ok) return fail(`[buildVoice] ${source.id}: ${maxVolume.reason}`);
    if (!Number.isFinite(maxVolume.value)) return fail(`[buildVoice] ${source.id}: the cut is silent`);
    const trimmed = await runCommand(["ffmpeg", "-y", "-v", "error", "-i", shapedPath, "-af", describeTrimFilter(maxVolume.value - TRIM_BELOW_PEAK_DB), "-c:a", "pcm_f32le", trimmedPath]);
    if (!trimmed.ok) return fail(`[buildVoice] ${source.id}: ${trimmed.reason}`);
  }
  const trimmedDuration = await measureDurationS(trimmedPath);
  if (!trimmedDuration.ok) return fail(`[buildVoice] ${source.id}: ${trimmedDuration.reason}`);
  const loudness = await measureLoudness(trimmedPath);
  if (!loudness.ok) return fail(`[buildVoice] ${source.id}: ${loudness.reason}`);
  const gainForLoudnessDb = list.targetLufs - loudness.value.integratedLufs;
  const gainDb = Math.min(gainForLoudnessDb, list.peakCeilingDbfs - loudness.value.samplePeakDbfs);
  const fadeOutStartS = Math.max(0, trimmedDuration.value - FADE_OUT_S);
  const finishing = `volume=${gainDb.toFixed(2)}dB,afade=t=in:d=${FADE_IN_S},afade=t=out:st=${fadeOutStartS.toFixed(4)}:d=${FADE_OUT_S}`;
  const encoded = await runCommand([
    "ffmpeg", "-y", "-v", "error", "-i", trimmedPath, "-af", finishing,
    "-ac", "1", "-ar", String(list.sampleRate), "-c:a", "libvorbis", "-b:a", `${list.bitrateKbps}k`, "-map_metadata", "-1", outputPath,
  ]);
  if (!encoded.ok) return fail(`[buildVoice] ${source.id}: ${encoded.reason}`);
  const shipped = await measureLoudness(outputPath);
  if (!shipped.ok) return fail(`[buildVoice] ${source.id}: ${shipped.reason}`);
  const shippedDuration = await measureDurationS(outputPath);
  if (!shippedDuration.ok) return fail(`[buildVoice] ${source.id}: ${shippedDuration.reason}`);
  return succeed({
    source,
    fileName,
    bytes: statSync(outputPath).size,
    durationS: shippedDuration.value,
    peakDbfs: shipped.value.samplePeakDbfs,
    loudnessLufs: shipped.value.integratedLufs,
    gainDb,
  });
}

function describeProcessing(source: VoiceSource): string {
  const cut = `cut ${source.startS} s + ${source.lengthS} s`;
  const pitch = source.semitones === 0 ? "no pitch shift" : `pitched ${source.semitones > 0 ? "up" : "down"} ${Math.abs(source.semitones)} semitones`;
  const trim = source.keepLength ? "length kept" : "silence trimmed";
  return `${cut}, ${pitch}, ${trim}`;
}

function writeGeneratedVoiceFiles(voices: readonly BuiltVoice[], list: SourceList): void {
  const rows = voices.map(
    (voice) =>
      `  { id: "${voice.source.id}", need: "${voice.source.need}", url: "${list.publicPrefix}/${voice.fileName}", durationS: ${voice.durationS.toFixed(3)}, peakDbfs: ${voice.peakDbfs.toFixed(1)} },`,
  );
  const text = ['import type { VoiceFile } from "./voices";', "", "export const VOICE_FILES: readonly VoiceFile[] = [", ...rows, "];", ""].join("\n");
  writeFileSync(GENERATED_TS_PATH, text);
}

function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|");
}

function writeCredits(voices: readonly BuiltVoice[], list: SourceList): void {
  const rows = voices.map((voice) =>
    [
      `\`${voice.fileName}\``,
      escapeCell(voice.source.what),
      `[${escapeCell(voice.source.title)}](${voice.source.sourcePage})`,
      escapeCell(voice.source.author),
      escapeCell(voice.source.licence),
      describeProcessing(voice.source),
    ].join(" | "),
  );
  const text = [
    "# Credits",
    "",
    "## Sounds",
    "",
    "`tools/audio/build-voices.ts` writes this file from `tools/audio/voice-sources.json`, the same list that builds the voice files. Edit the list and rerun the script; never edit this file by hand.",
    "",
    "Paper sounds and the felt-piano music are synthesised in code at run time (`app/src/lib/papercraft/lib/paper-sound.js`, `app/src/lib/audio/`). They use no recordings.",
    "",
    `Every voice file in \`${list.outputDir}/\` is CC0 or public domain, so none needs attribution. Each one is credited here anyway. Each file was low-passed at ${list.lowpassHz / 1000} kHz, normalised to ${list.targetLufs} LUFS with its peaks held at or under ${list.peakCeilingDbfs} dBFS, and exported as mono Ogg Vorbis at ${list.bitrateKbps} kbit/s. The table gives each file's cut, pitch shift and silence trim.`,
    "",
    "| Shipped file | What it is | Source | Author | Licence as stated on the source page | Processing |",
    "|---|---|---|---|---|---|",
    ...rows.map((row) => `| ${row} |`),
    "",
  ].join("\n");
  mkdirSync(path.dirname(CREDITS_PATH), { recursive: true });
  writeFileSync(CREDITS_PATH, text);
}

function removeStaleOutputs(list: SourceList): string[] {
  const outputDir = path.join(REPO_ROOT, list.outputDir);
  const expected = new Set(list.files.map((file) => `${file.id}.ogg`));
  const stale = readdirSync(outputDir).filter((name) => name.endsWith(".ogg") && !expected.has(name));
  for (const name of stale) rmSync(path.join(outputDir, name));
  return stale;
}

async function main(): Promise<number> {
  const parsed = parseSourceList(JSON.parse(readFileSync(SOURCES_PATH, "utf8")));
  if (!parsed.ok) {
    console.error(`[main] ${parsed.reason}`);
    return 1;
  }
  const list = parsed.value;
  if (!(await hasRubberband())) {
    console.error("[main] ffmpeg has no rubberband filter; this script needs it for the pitch shifts");
    return 1;
  }
  rmSync(WORK_DIR, { recursive: true, force: true });
  mkdirSync(WORK_DIR, { recursive: true });
  mkdirSync(path.join(REPO_ROOT, list.outputDir), { recursive: true });
  const voices: BuiltVoice[] = [];
  for (const source of list.files) {
    const built = await buildVoice(source, list);
    if (!built.ok) {
      console.error(`[main] ${built.reason}`);
      return 1;
    }
    voices.push(built.value);
    const { durationS, peakDbfs, loudnessLufs, bytes, gainDb } = built.value;
    console.info(
      `[main] ${source.id}: ${durationS.toFixed(2)} s, ${(bytes / BYTES_PER_KB).toFixed(1)} KB, ${loudnessLufs.toFixed(1)} LUFS, peak ${peakDbfs.toFixed(1)} dBFS, gain ${gainDb.toFixed(1)} dB`,
    );
  }
  rmSync(WORK_DIR, { recursive: true, force: true });
  const stale = removeStaleOutputs(list);
  if (stale.length > 0) console.info(`[main] removed stale files: ${stale.join(", ")}`);
  const totalKb = voices.reduce((sum, voice) => sum + voice.bytes, 0) / BYTES_PER_KB;
  console.info(`[main] ${voices.length} files, ${totalKb.toFixed(1)} KB of a ${list.budgetKb} KB budget`);
  writeGeneratedVoiceFiles(voices, list);
  writeCredits(voices, list);
  if (totalKb > list.budgetKb) {
    console.error(`[main] the voice files take ${totalKb.toFixed(1)} KB, above the ${list.budgetKb} KB budget`);
    return 1;
  }
  return 0;
}

process.exit(await main());
