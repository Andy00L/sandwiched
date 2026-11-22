import * as THREE from "three";
import type { Harness, PlacedPiece } from "papercraft/harness.js";
import * as P2 from "papercraft/lib/paperkit-2d.js";
import { FlapSpring } from "papercraft/lib/paperkit-3d.js";
import type { RecordedRound } from "../../game/round-events";
import { viewStateAt } from "../../game/view-state";
import { HOVER_HEIGHT_UNITS, REVEAL_LID_STAGGER_S } from "../motion/motion-tokens";
import { crumbOutline, mothCard, paintCrumb, SANDWICH_BITE_STAGES, sandwichCard } from "../pieces/lunch";
import { LUNCHBOX_DEPTH_UNITS, LUNCHBOX_HEIGHT_UNITS, LUNCHBOX_WIDTH_UNITS } from "../pieces/lunchbox";
import type { LunchboxModel } from "../pieces/lunchbox";
import { PIGEON_VARIANTS, printCropBags, printStunStar } from "../pieces/pigeon";
import type { PigeonKit, PigeonVariant } from "../pieces/pigeon";
import type { PicnicTable } from "../pieces/table";
import { restHandPosition, TOWARD_CAMERA_IN_WHALE } from "../pieces/whale";
import type { WhaleModel } from "../pieces/whale";
import { poseArm } from "./arm-rig";
import type { ArmRig } from "./arm-rig";
import { createPigeonActor, printPigeonVariant } from "./pigeon-actor";
import type { PigeonActor, PigeonPose } from "./pigeon-actor";
import { BOX_ROW_DECK_Z, boxAlong, hoverSpot, perchSpot } from "./perches";
import type { PerchSpot } from "./perches";
import { createRoundDirector } from "./round-director";
import type { FlightEnd, SeatPose } from "./round-director";
import { raisedHandPosition, slamHandPosition } from "./slam";
import { createMoodGovernor, crowdedGlance, glanceTowardBox } from "./whale-mood";
import { boxHopRad, cameraDropUnits, deckDipRad, flipperShakeRad, hitStopMs, lidPopAmount, presentationTick, torsoLeanRad } from "../motion/impact";

const REPLAY_LEAD_S = 2.5;
const WHISTLE_S = 0.4;
const CRUMB_BITS_PER_BOX = 16;
const CRUMB_BITS_COUNTED_ONE_BY_ONE = 12;
const CRUMBS_PER_LATER_BIT = 5;
const REVEAL_PROP_DELAY_S = 0.08;
const ANGRY_AFTER_LANDING_MS = 400;
const SPOUT_MIN_HITS = 3;
const MISS_LOOK_MS = 600;
const CRUMB_FLIGHT_MIN_MS = 350;
const CRUMB_FLIGHT_SPREAD_MS = 250;
const CRUMB_LAUNCH_HEIGHT_UNITS = 2;
const CRUMB_ARC_PEAK_UNITS = 2.2;
const CRUMB_TUMBLE_RAD_PER_S = 1.5;

interface CrumbFlight {
  fromAlong: number;
  fromDeckZ: number;
  startTick: number;
  durationTicks: number;
}

interface CrumbBit {
  piece: PlacedPiece;
  isShown: boolean;
  homeAlong: number;
  homeDeckZ: number;
  homeYaw: number;
  flight: CrumbFlight | null;
}

interface SwatLanding {
  tick: number;
  hitCount: number;
  box: number;
  hitSeats: readonly number[];
  hasFlinched: boolean;
}

interface RevealBox {
  box: LunchboxModel;
  prop: PlacedPiece;
  lidSpring: FlapSpring;
  hasOpened: boolean;
}

function lidContactLocal(deck: THREE.Object3D, whaleGroup: THREE.Object3D, boxIndex: number, boxCount: number): THREE.Vector3 {
  deck.updateWorldMatrix(true, false);
  const lidCentre = deck.localToWorld(new THREE.Vector3(boxAlong(boxIndex, boxCount), LUNCHBOX_HEIGHT_UNITS + 0.2, BOX_ROW_DECK_Z - LUNCHBOX_DEPTH_UNITS * 0.35));
  whaleGroup.updateWorldMatrix(true, false);
  return whaleGroup.worldToLocal(lidCentre);
}

function armForBox(whale: WhaleModel, boxIndex: number, boxCount: number): ArmRig {
  return boxIndex >= boxCount - 1 ? whale.rightArm : whale.leftArm;
}

function crumbBitCount(looseCrumbs: number): number {
  const bits =
    looseCrumbs <= CRUMB_BITS_COUNTED_ONE_BY_ONE
      ? looseCrumbs
      : CRUMB_BITS_COUNTED_ONE_BY_ONE + Math.ceil((looseCrumbs - CRUMB_BITS_COUNTED_ONE_BY_ONE) / CRUMBS_PER_LATER_BIT);
  return Math.min(CRUMB_BITS_PER_BOX, Math.max(0, bits));
}

function startingPotOf(round: RecordedRound): number {
  const draw = round.events.find((event) => event.kind === "whaleDrawn");
  return draw ? viewStateAt(round, draw.tick).pot : 0;
}

function biteStageAtSettlement(round: RecordedRound, startingPot: number): number {
  const lastTick = round.events.at(-1)?.tick ?? 0;
  if (startingPot <= 0) return 0;
  const eatenShare = (startingPot - viewStateAt(round, lastTick).pot) / startingPot;
  return Math.min(SANDWICH_BITE_STAGES, Math.max(0, Math.floor(eatenShare * SANDWICH_BITE_STAGES)));
}

function buildCrumbBits(harness: Harness, deck: THREE.Object3D, boxCount: number, order: number): CrumbBit[][] {
  const outline = crumbOutline(P2.rng(611));
  const materials = harness.printed(outline, paintCrumb);
  return [...Array(boxCount).keys()].map((boxIndex) => {
    const random = P2.rng(640 + boxIndex);
    return [...Array(CRUMB_BITS_PER_BOX).keys()].map((bitIndex): CrumbBit => {
      const homeAlong = boxAlong(boxIndex, boxCount) + (random() * 2 - 1) * (LUNCHBOX_WIDTH_UNITS / 2 + 0.8);
      const homeDeckZ = BOX_ROW_DECK_Z + 0.3 + random() * 1.5;
      const homeYaw = (random() - 0.5) * 1.2;
      const piece = harness.popup(outline, null, { materials, parent: deck, x: homeAlong, z: homeDeckZ, yaw: homeYaw, order: order + bitIndex * 0.01 });
      piece.group.visible = false;
      return { piece, isShown: false, homeAlong, homeDeckZ, homeYaw, flight: null };
    });
  });
}

function buildRevealBoxes(harness: Harness, deck: THREE.Object3D, boxes: readonly LunchboxModel[], round: RecordedRound, startingPot: number, order: number): RevealBox[] {
  const sandwichBox = round.events.find((event) => event.kind === "whaleDrawn")?.sandwichBox ?? null;
  const [mothOutline, paintMoth] = mothCard();
  const mothMaterials = harness.printed(mothOutline, paintMoth);
  const [sandwichOutline, paintSandwich] = sandwichCard(biteStageAtSettlement(round, startingPot));
  return boxes.map((box, boxIndex) => {
    const placement = { parent: deck, x: boxAlong(boxIndex, boxes.length), z: BOX_ROW_DECK_Z - LUNCHBOX_DEPTH_UNITS * 0.78, yaw: 0, order: order + boxIndex * 0.05 };
    const prop =
      boxIndex === sandwichBox
        ? harness.popup(sandwichOutline, paintSandwich, placement)
        : harness.popup(mothOutline, null, { ...placement, materials: mothMaterials });
    prop.group.visible = false;
    return { box, prop, lidSpring: new FlapSpring({ p: 0, size: 0.35 }), hasOpened: false };
  });
}

function spotOf(end: FlightEnd, hover: PerchSpot, boxCount: number): PerchSpot {
  return end === "hover" ? hover : perchSpot(end.box, boxCount, end.slot);
}

function heightOf(end: FlightEnd): number {
  return end === "hover" ? HOVER_HEIGHT_UNITS : 0;
}

function toPigeonPose(pose: SeatPose, hover: PerchSpot, boxCount: number): PigeonPose {
  switch (pose.kind) {
    case "hidden":
      return pose;
    case "hovering":
      return { kind: "hovering", spot: hover };
    case "drawn":
      return { kind: "folding", spot: hover, sinceTick: pose.sinceTick };
    case "flying":
      return {
        kind: "flying",
        from: spotOf(pose.from, hover, boxCount),
        to: spotOf(pose.to, hover, boxCount),
        fromHeight: heightOf(pose.from),
        toHeight: heightOf(pose.to),
        startTick: pose.startTick,
        landsTick: pose.landsTick,
      };
    case "perched":
      return { kind: "perched", spot: spotOf(pose.at, hover, boxCount) };
    case "stunned":
      return { kind: "stunned", spot: spotOf(pose.at, hover, boxCount), cause: pose.cause, sinceTick: pose.sinceTick, untilTick: pose.untilTick };
  }
}

export function buildReplayScene(harness: Harness, table: PicnicTable, whale: WhaleModel, boxes: readonly LunchboxModel[], round: RecordedRound): void {
  const { deck } = table;
  const { boxCount, tickMs } = round;
  const director = createRoundDirector(round);
  const order = table.table.order + 1.2;
  const kits = new Map<PigeonVariant, PigeonKit>();
  const cropBags = printCropBags(harness.cardOpts(0, 0, 1, deck));
  const star = printStunStar(harness.cardOpts(0, 0, 1, deck));
  const actors = round.players.map((player, playerIndex) => {
    const variant = PIGEON_VARIANTS[player.variant % PIGEON_VARIANTS.length] ?? "gary";
    const kit = kits.get(variant) ?? printPigeonVariant(harness, deck, variant);
    kits.set(variant, kit);
    const actor: PigeonActor = createPigeonActor(harness, deck, { kit, cropBags, star }, player.seat, order + playerIndex * 0.05);
    return { seat: player.seat, actor, hover: hoverSpot(playerIndex) };
  });
  const actorBySeat = new Map(actors.map((entry) => [entry.seat, entry.actor]));
  const crumbBits = buildCrumbBits(harness, deck, boxCount, order + 2);
  const startingPot = startingPotOf(round);
  const revealBoxes = buildRevealBoxes(harness, deck, boxes, round, startingPot, order + 3);
  const moodGovernor = createMoodGovernor();
  const angryTicksAfterLanding = ANGRY_AFTER_LANDING_MS / tickMs;
  const settledTick = round.events.findLast((event) => event.kind === "settled")?.tick ?? Number.POSITIVE_INFINITY;
  const revealStartTick = settledTick + (WHISTLE_S * 1000) / tickMs;
  const lidStaggerTicks = (REVEAL_LID_STAGGER_S * 1000) / tickMs;
  const windupMs = round.timing.swatWindupTicks * tickMs;
  const baseTargetY = harness.target.y;
  let revealOrder: RevealBox[] | null = null;
  let lastLanding: SwatLanding | null = null;
  let previousPresentationTick: number | null = null;
  let missUntilMs = Number.NEGATIVE_INFINITY;

  function sortNearestFirst(reveals: readonly RevealBox[]): RevealBox[] {
    const cameraPosition = harness.camera.getWorldPosition(new THREE.Vector3());
    return reveals
      .map((reveal) => ({ reveal, distance: reveal.box.node.getWorldPosition(new THREE.Vector3()).distanceTo(cameraPosition) }))
      .sort((first, second) => first.distance - second.distance)
      .map(({ reveal }) => reveal);
  }

  function poseArms(nowTick: number): void {
    const raises = director.latestRaises();
    for (const rig of [whale.leftArm, whale.rightArm]) {
      const raise = raises
        .filter((candidate) => armForBox(whale, candidate.box, boxCount) === rig)
        .reduce<(typeof raises)[number] | null>((latest, candidate) => (latest && latest.tick >= candidate.tick ? latest : candidate), null);
      const rest = restHandPosition(rig.side);
      const msFromLanding = raise ? (nowTick - raise.landsTick) * tickMs : Number.POSITIVE_INFINITY;
      const hand = raise
        ? slamHandPosition({ rest, raised: raisedHandPosition(rig.shoulder, rig.side), contact: lidContactLocal(deck, whale.group, raise.box, boxCount) }, msFromLanding, windupMs)
        : rest;
      poseArm(rig, hand, TOWARD_CAMERA_IN_WHALE);
      rig.fore.rotateZ(flipperShakeRad(msFromLanding));
    }
    const latestRaise = raises.reduce<(typeof raises)[number] | null>((latest, candidate) => (latest && latest.tick >= candidate.tick ? latest : candidate), null);
    whale.whale.sway = latestRaise ? -torsoLeanRad((nowTick - latestRaise.landsTick) * tickMs, windupMs) : 0;
  }

  function launchCrumb(bit: CrumbBit, bitIndex: number, landing: SwatLanding, presentTick: number): void {
    const hitSeat = landing.hitSeats[bitIndex % Math.max(1, landing.hitSeats.length)];
    const hitPose = hitSeat === undefined ? null : director.poseOf(hitSeat, presentTick);
    const from = hitPose && (hitPose.kind === "stunned" || hitPose.kind === "perched") ? perchSpot(hitPose.at.box, boxCount, hitPose.at.slot) : null;
    if (!from) return;
    bit.flight = { fromAlong: from.along, fromDeckZ: from.deckZ, startTick: landing.tick, durationTicks: (CRUMB_FLIGHT_MIN_MS + ((bitIndex * 97) % CRUMB_FLIGHT_SPREAD_MS)) / tickMs };
  }

  function placeCrumb(bit: CrumbBit, presentTick: number): void {
    const flight = bit.flight;
    const progress = flight ? (presentTick - flight.startTick) / flight.durationTicks : 1;
    if (!flight || progress >= 1) {
      bit.flight = null;
      bit.piece.group.position.set(bit.homeAlong, 0.01, bit.homeDeckZ);
      bit.piece.group.rotation.y = bit.homeYaw;
      return;
    }
    const clamped = Math.max(0, progress);
    bit.piece.group.position.set(
      flight.fromAlong + (bit.homeAlong - flight.fromAlong) * clamped,
      0.01 + CRUMB_LAUNCH_HEIGHT_UNITS * (1 - clamped) + CRUMB_ARC_PEAK_UNITS * 4 * clamped * (1 - clamped),
      flight.fromDeckZ + (bit.homeDeckZ - flight.fromDeckZ) * clamped,
    );
    bit.piece.group.rotation.y = bit.homeYaw + ((presentTick - flight.startTick) * tickMs * CRUMB_TUMBLE_RAD_PER_S) / 1000;
  }

  function showCrumbs(looseCrumbs: readonly number[], presentTick: number, nowTick: number): void {
    crumbBits.forEach((bits, boxIndex) => {
      const shownCount = crumbBitCount(looseCrumbs[boxIndex] ?? 0);
      const landing = lastLanding && lastLanding.box === boxIndex && nowTick - lastLanding.tick < (hitStopMs(lastLanding.hitCount) + CRUMB_FLIGHT_MIN_MS) / tickMs ? lastLanding : null;
      bits.forEach((bit, bitIndex) => {
        const shouldShow = bitIndex < shownCount;
        if (shouldShow && !bit.isShown) {
          if (landing) {
            bit.piece.reset(1);
            launchCrumb(bit, bitIndex, landing, presentTick);
          } else {
            bit.piece.reset(0);
            bit.piece.set(1, 0);
          }
        }
        if (!shouldShow) bit.flight = null;
        bit.isShown = shouldShow;
        bit.piece.group.visible = shouldShow;
        if (shouldShow) placeCrumb(bit, presentTick);
      });
    });
  }

  function playImpact(presentTick: number, nowTick: number): void {
    const releaseTick = lastLanding ? lastLanding.tick + hitStopMs(lastLanding.hitCount) / tickMs : Number.POSITIVE_INFINITY;
    const impactMs = lastLanding && nowTick >= releaseTick ? (presentTick - lastLanding.tick) * tickMs : -1;
    const landing = lastLanding;
    table.table.sway = deckDipRad(impactMs);
    harness.target.y = baseTargetY - cameraDropUnits(impactMs);
    boxes.forEach((box, boxIndex) => {
      const distance = landing ? Math.abs(boxAlong(boxIndex, boxCount) - boxAlong(landing.box, boxCount)) : 0;
      box.piece.sway = landing && boxIndex !== landing.box ? boxHopRad(impactMs, distance) : 0;
      if (presentTick < revealStartTick) box.setLidOpen(landing && boxIndex === landing.box ? lidPopAmount(impactMs) : 0);
    });
    if (!landing || impactMs < 0 || landing.hasFlinched) return;
    landing.hasFlinched = true;
    for (const { seat, actor } of actors) {
      const pose = director.poseOf(seat, presentTick);
      if (pose.kind === "perched" && pose.at.box !== landing.box) actor.flinch(presentTick);
    }
  }

  function playReveal(nowTick: number, dtSeconds: number): void {
    if (nowTick < revealStartTick) {
      for (const reveal of revealBoxes) reveal.prop.group.visible = false;
      return;
    }
    revealOrder ??= sortNearestFirst(revealBoxes);
    revealOrder.forEach((reveal, rank) => {
      if (!reveal.hasOpened && nowTick >= revealStartTick + rank * lidStaggerTicks) {
        reveal.hasOpened = true;
        reveal.lidSpring.set(1);
        reveal.prop.reset(0);
        reveal.prop.set(1, REVEAL_PROP_DELAY_S);
      }
      reveal.prop.group.visible = reveal.hasOpened;
      reveal.box.setLidOpen(reveal.lidSpring.step(dtSeconds));
    });
  }

  function actFace(nowTick: number, nowMs: number, dtSeconds: number): void {
    const view = director.view();
    const isAngry = director.latestRaises().some((raise) => nowTick >= raise.tick && nowTick < raise.landsTick + angryTicksAfterLanding);
    const potShare = startingPot > 0 && view.phase !== "lobby" ? view.pot / startingPot : 1;
    const missedBox = lastLanding && nowMs < missUntilMs ? lastLanding.box : null;
    if (missedBox !== null) whale.face.setMood("alert", glanceTowardBox(missedBox, boxCount));
    else whale.face.setMood(isAngry ? "angry" : moodGovernor.moodAt(potShare, nowMs), crowdedGlance(view, boxCount));
    whale.face.step(dtSeconds, nowMs);
  }

  harness.onRestart(() => {
    director.reset();
    moodGovernor.reset();
    whale.face.reset();
    revealOrder = null;
    lastLanding = null;
    previousPresentationTick = null;
    missUntilMs = Number.NEGATIVE_INFINITY;
    harness.target.y = baseTargetY;
    table.table.sway = 0;
    whale.whale.sway = 0;
    for (const box of boxes) box.piece.sway = 0;
    for (const { actor } of actors) actor.reset();
    for (const bits of crumbBits) {
      for (const bit of bits) {
        bit.isShown = false;
        bit.flight = null;
      }
    }
    for (const reveal of revealBoxes) {
      reveal.hasOpened = false;
      reveal.lidSpring.reset(0);
      reveal.box.setLidOpen(0);
    }
  });

  harness.onStep((timeSeconds, dtSeconds) => {
    const nowTick = ((timeSeconds - REPLAY_LEAD_S) * 1000) / tickMs;
    for (const event of director.advanceTo(Math.floor(nowTick))) {
      if (event.kind === "pecked" && event.outcome !== "emptyBox") actorBySeat.get(event.seat)?.peck(event.tick);
      if (event.kind === "swatLanded") {
        lastLanding = { tick: event.tick, hitCount: event.hits.length, box: event.box, hitSeats: event.hits.map((hit) => hit.seat), hasFlinched: false };
        if (event.hits.length >= SPOUT_MIN_HITS) whale.face.popSpout(event.tick * tickMs);
        if (event.hits.length === 0) missUntilMs = event.tick * tickMs + MISS_LOOK_MS;
      }
    }
    const presentTick = presentationTick(nowTick, lastLanding, tickMs);
    const presentDt = previousPresentationTick === null ? dtSeconds : Math.max(0, ((presentTick - previousPresentationTick) * tickMs) / 1000);
    previousPresentationTick = presentTick;
    const beakCrumbsBySeat = new Map(director.view().seats.map((seatView) => [seatView.seat, seatView.beakCrumbs]));
    for (const { seat, actor, hover } of actors) {
      actor.update(toPigeonPose(director.poseOf(seat, presentTick), hover, boxCount), presentTick, tickMs, presentDt);
      actor.showBeakCrumbs(beakCrumbsBySeat.get(seat) ?? 0);
    }
    poseArms(presentTick);
    actFace(presentTick, presentTick * tickMs, presentDt);
    showCrumbs(director.view().looseCrumbs, presentTick, nowTick);
    playImpact(presentTick, nowTick);
    playReveal(presentTick, presentDt);
  });
}
