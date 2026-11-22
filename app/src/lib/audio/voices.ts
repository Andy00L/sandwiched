export const VOICE_NEEDS = [
  "pigeonCoo",
  "pigeonTakeoff",
  "pigeonOw",
  "pigeonGulp",
  "pigeonFlattened",
  "pigeonDizzy",
  "pigeonHeh",
  "pigeonCheer",
  "pigeonGroan",
  "whaleHum",
  "whaleWindup",
  "whaleGrunt",
  "whalePleased",
  "whaleWhimper",
  "whaleSigh",
  "whaleWhat",
  "whaleOwOw",
  "refereeWhistle",
] as const;

export type VoiceNeed = (typeof VOICE_NEEDS)[number];

export type VoiceFile = { id: string; need: VoiceNeed; url: string; durationS: number; peakDbfs: number };

export type VoiceCharacter = { kind: "pigeon"; seat: number } | { kind: "whale" } | { kind: "referee" } | { kind: "crowd" } | { kind: "flock" };

type VoiceRule = { priority: number; minGapS: number; isUnducked: boolean; canInterrupt: boolean };

const rule = (priority: number, minGapS = 0): VoiceRule => ({ priority, minGapS, isUnducked: false, canInterrupt: false });

export const VOICE_RULES: Readonly<Record<VoiceNeed, VoiceRule>> = {
  pigeonCoo: rule(1, 8),
  pigeonTakeoff: rule(1, 1.2),
  pigeonOw: rule(2),
  pigeonGulp: rule(1, 4),
  pigeonFlattened: rule(2),
  pigeonDizzy: rule(2),
  pigeonHeh: rule(2, 4),
  pigeonCheer: rule(2),
  pigeonGroan: rule(2),
  whaleHum: rule(2, 10),
  whaleWindup: rule(3),
  whaleGrunt: { ...rule(3), isUnducked: true, canInterrupt: true },
  whalePleased: rule(2),
  whaleWhimper: rule(2),
  whaleSigh: rule(2),
  whaleWhat: rule(2),
  whaleOwOw: rule(2, 4),
  refereeWhistle: rule(3),
};

export function characterKey(character: VoiceCharacter): string {
  return character.kind === "pigeon" ? `pigeon:${character.seat}` : character.kind;
}
