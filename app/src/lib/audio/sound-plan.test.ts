import { describe, expect, test } from "bun:test";
import { ROUND_SCHEMA_VERSION } from "../game/round-events";
import type { RecordedRound, RoundEvent, RoundTiming } from "../game/round-events";
import { hitStopMs } from "../table/motion/impact";
import { REVEAL_LID_STAGGER_S, WHISTLE_S } from "../table/motion/motion-tokens";
import { planRoundOffline } from "./offline-round";
import { PATTER_SPAN_S, PATTER_START_S, createSoundPlanner } from "./sound-plan";
import type { PlannedSound } from "./sound-plan";
import { VOICE_FILES } from "./voice-files.generated";
import type { VoiceNeed } from "./voices";

const TICK_MS = 10;
const WHALE_SEAT = 2;
const TIMING: RoundTiming = {
  lobbyTicks: 100,
  drawTimeoutTicks: 50,
  hideTicks: 50,
  roundTicks: 4500,
  flightTicks: 50,
  peckCooldownTicks: 30,
  emptyBoxStunTicks: 200,
  swatWindupTicks: 35,
  swatCooldownTicks: 90,
  swatStunTicks: 150,
  switchCooldownTicks: 800,
};

function makeRound(events: readonly RoundEvent[]): RecordedRound {
  return {
    version: ROUND_SCHEMA_VERSION,
    seed: 5,
    tickMs: TICK_MS,
    boxCount: 3,
    timing: TIMING,
    chipsPerAnte: 100,
    players: [0, 1, 2, 3].map((seat) => ({ seat, name: `Seat ${seat}`, variant: seat, temperament: "greedy" as const })),
    events: [{ tick: 0, kind: "whaleDrawn", whaleSeat: WHALE_SEAT, sandwichBox: 1, endTick: 900 }, ...events],
  };
}

const planOf = (events: readonly RoundEvent[], ownSeat: number | null) => planRoundOffline(makeRound(events), { files: VOICE_FILES, ownSeat }).sounds;

const voicesOf = (sounds: readonly PlannedSound[], need: VoiceNeed) => sounds.flatMap((sound) => (sound.kind === "voice" && sound.play.file.need === need ? [sound] : []));

const rewardsOf = (sounds: readonly PlannedSound[]) => sounds.flatMap((sound) => (sound.kind === "reward" ? [sound] : []));

const SLAM_ON_BOX_1: readonly RoundEvent[] = [
  { tick: 10, kind: "landed", seat: 0, box: 1 },
  { tick: 11, kind: "landed", seat: 1, box: 1 },
  { tick: 12, kind: "landed", seat: 3, box: 1 },
  { tick: 100, kind: "handRaised", box: 1, swatNumber: 1, landsTick: 135 },
];

describe("the slam", () => {
  const hits = [0, 1, 3].map((seat) => ({ seat, droppedCrumbs: 3, untilTick: 285 }));
  const sounds = planOf([...SLAM_ON_BOX_1, { tick: 135, kind: "swatLanded", box: 1, swatNumber: 1, hits }], WHALE_SEAT);
  const releaseS = 1.35 + hitStopMs(hits.length) / 1000;

  test("the wind-up starts with the raise and the grunt starts at contact", () => {
    const [windup] = voicesOf(sounds, "whaleWindup");
    const [grunt] = voicesOf(sounds, "whaleGrunt");
    expect(windup?.atS).toBeCloseTo(1);
    expect(grunt?.atS).toBeCloseTo(1.35);
  });

  test("a contact that comes before the wind-up has finished cuts it", () => {
    const early = planOf([{ tick: 100, kind: "handRaised", box: 1, swatNumber: 1, landsTick: 120 }, { tick: 120, kind: "swatLanded", box: 1, swatNumber: 1, hits: [] }], null);
    const [windup] = voicesOf(early, "whaleWindup");
    const [grunt] = voicesOf(early, "whaleGrunt");
    expect(grunt?.play.cuts).toEqual([windup?.play.playId ?? -1]);
  });

  test("the flipper whooshes as it rises, then lands as one flap plus a table thump that ducks everything", () => {
    const paper = sounds.flatMap((sound) => (sound.kind === "paper" ? [sound] : []));
    expect(paper.some((sound) => sound.recipe.kind === "flap" && sound.recipe.tone === "whoosh" && Math.abs(sound.atS - 1) < 1e-9)).toBe(true);
    const slam = paper.filter((sound) => sound.isSlam);
    expect(slam.map((sound) => sound.recipe.kind).sort()).toEqual(["flap", "thump"]);
    for (const sound of slam) expect(sound.atS).toBeCloseTo(releaseS);
    expect(sounds.filter((sound) => sound.kind === "duck").map((sound) => sound.atS)).toEqual([releaseS]);
  });

  test("dropped crumbs patter 6 to 10 times over 400 ms, each quieter than the last", () => {
    const patter = sounds.flatMap((sound) => (sound.kind === "paper" && sound.source === "tick" && sound.atS > releaseS && sound.atS < releaseS + 1 ? [sound] : []));
    expect(patter.length).toBeGreaterThanOrEqual(6);
    expect(patter.length).toBeLessThanOrEqual(10);
    for (const tick of patter) expect(tick.atS - releaseS).toBeGreaterThanOrEqual(PATTER_START_S - 1e-9);
    for (const tick of patter) expect(tick.atS - releaseS).toBeLessThanOrEqual(PATTER_START_S + PATTER_SPAN_S + 1e-9);
    expect(patter.every((tick, index) => index === 0 || tick.gain < (patter[index - 1]?.gain ?? 0))).toBe(true);
  });

  test("the whale player hears two rising low notes for a hit of 3 or more", () => {
    const slamRewards = rewardsOf(sounds).filter((reward) => reward.atS > 1);
    expect(slamRewards).toEqual([{ kind: "reward", atS: releaseS, register: "low", noteCount: 2 }]);
  });

  test("a pigeon player hears no whale reward", () => {
    const asPigeon = planOf([...SLAM_ON_BOX_1, { tick: 135, kind: "swatLanded", box: 1, swatNumber: 1, hits }], 0);
    expect(rewardsOf(asPigeon).filter((reward) => reward.atS > 1)).toEqual([]);
  });

  test("a slam that hits nobody makes the whale ask what happened", () => {
    const missed = planOf([...SLAM_ON_BOX_1, { tick: 135, kind: "swatLanded", box: 1, swatNumber: 1, hits: [] }], null);
    expect(voicesOf(missed, "whaleWhat").length).toBe(1);
    expect(voicesOf(missed, "pigeonFlattened").length).toBe(0);
  });

  test("a pigeon that leaves the box during the wind-up says heh", () => {
    const dodged = planOf([...SLAM_ON_BOX_1, { tick: 120, kind: "tookOff", seat: 1 }, { tick: 135, kind: "swatLanded", box: 1, swatNumber: 1, hits: [] }], null);
    expect(voicesOf(dodged, "pigeonHeh").map((voice) => voice.atS)).toEqual([1.2]);
  });
});

describe("crumbs are notes", () => {
  const pecks: readonly RoundEvent[] = [
    { tick: 200, kind: "pecked", seat: 0, box: 1, outcome: "sandwichCrumb" },
    { tick: 260, kind: "pecked", seat: 0, box: 0, outcome: "looseCrumb" },
    { tick: 320, kind: "pecked", seat: 1, box: 1, outcome: "sandwichCrumb" },
  ];

  test("only the player's own crumbs play a note: high from the sandwich, middle when loose", () => {
    const rewards = rewardsOf(planOf(pecks, 0)).filter((reward) => reward.atS > 1);
    expect(rewards.map((reward) => [reward.register, reward.noteCount])).toEqual([
      ["high", 1],
      ["middle", 1],
    ]);
  });

  test("a watcher with no seat hears no crumb notes", () => {
    expect(rewardsOf(planOf(pecks, null)).filter((reward) => reward.atS > 1)).toEqual([]);
  });
});

describe("the bonk", () => {
  const sounds = planOf(
    [
      { tick: 10, kind: "landed", seat: 0, box: 2 },
      { tick: 300, kind: "pecked", seat: 0, box: 2, outcome: "emptyBox", untilTick: 500 },
      { tick: 500, kind: "stunEnded", seat: 0 },
    ],
    null,
  );

  test("an empty box answers with a hollow knock and an ow", () => {
    expect(sounds.some((sound) => sound.kind === "paper" && sound.recipe.kind === "flap" && sound.recipe.tone === "knock")).toBe(true);
    expect(voicesOf(sounds, "pigeonOw").length).toBe(1);
  });

  test("the pigeon gets up dizzy with a rising flap", () => {
    expect(voicesOf(sounds, "pigeonDizzy").length).toBe(1);
    expect(sounds.some((sound) => sound.kind === "paper" && sound.source === "risingFlap" && Math.abs(sound.atS - 5) < 1e-9)).toBe(true);
  });
});

describe("the end of the round", () => {
  const sounds = planOf([{ tick: 900, kind: "settled", whaleCrumbs: 600, pigeonCrumbs: 400, beaks: [] }], null);

  test("the kitchen timer ticks once per second in the last 5 seconds", () => {
    const timerTicks = sounds.flatMap((sound) => (sound.kind === "paper" && sound.recipe.kind === "flap" && sound.recipe.tone === "timer" ? [sound.atS] : []));
    expect(timerTicks).toEqual([4, 5, 6, 7, 8]);
  });

  test("the whistle blows, then the three lids open 0.12 s apart despite the flap spacing", () => {
    expect(voicesOf(sounds, "refereeWhistle").map((voice) => voice.atS)).toEqual([9]);
    const lids = sounds.flatMap((sound) => (sound.kind === "paper" && sound.source === "risingFlap" && sound.atS >= 9 ? [sound.atS] : []));
    expect(lids.length).toBe(3);
    lids.forEach((atS, rank) => expect(atS).toBeCloseTo(9 + WHISTLE_S + rank * REVEAL_LID_STAGGER_S, 1));
  });

  test("the whale is pleased when it kept more", () => {
    expect(voicesOf(sounds, "whalePleased").length).toBe(1);
    expect(voicesOf(sounds, "pigeonGroan").length).toBe(1);
  });
});

describe("late frames", () => {
  test("events older than a quarter second make no sound, after a hidden tab or a late join", () => {
    const planner = createSoundPlanner({ files: VOICE_FILES, readOwnSeat: () => 0 });
    const round = makeRound([]);
    planner.beginRound(round);
    const heard: PlannedSound[] = [];
    const oldEvents: RoundEvent[] = [
      { tick: 100, kind: "handRaised", box: 1, swatNumber: 1, landsTick: 135 },
      { tick: 135, kind: "swatLanded", box: 1, swatNumber: 1, hits: [] },
      { tick: 200, kind: "pecked", seat: 0, box: 1, outcome: "sandwichCrumb" },
    ];
    planner.planFrame({ nowTick: 1000, presentTick: 1000, endTick: null }, oldEvents, [], (sound) => heard.push(sound));
    expect(heard).toEqual([]);
  });
});
