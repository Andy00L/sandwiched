import * as THREE from "three";
import type { Harness, PlacedPiece } from "papercraft/harness.js";
import * as P2 from "papercraft/lib/paperkit-2d.js";
import { FlapSpring } from "papercraft/lib/paperkit-3d.js";
import type { HandRaisedEvent, RecordedRound } from "../../game/round-events";
import { viewStateAt } from "../../game/view-state";
import type { RoundViewState } from "../../game/view-state";
import { HOVER_HEIGHT_UNITS, REVEAL_LID_STAGGER_S } from "../motion/motion-tokens";
import {
  boxHopRad,
  cameraDropUnits,
  deckDipRad,
  flipperShadowHeightUnits,
  flipperShakeRad,
  focusPullAmount,
  hitStopMs,
  isFlipperShadowShown,
  lidPopAmount,
  presentationTick,
  torsoLeanRad,
} from "../motion/impact";
import { crumbOutline, mothCard, paintCrumb, SANDWICH_BITE_STAGES, sandwichCard } from "../pieces/lunch";
import { LUNCHBOX_DEPTH_UNITS, LUNCHBOX_HEIGHT_UNITS, LUNCHBOX_WIDTH_UNITS } from "../pieces/lunchbox";
import type { LunchboxModel } from "../pieces/lunchbox";
import { PIGEON_VARIANTS, printCropBags, printFeather, printPressedProps, printStunStar } from "../pieces/pigeon";
import type { PigeonKit, PigeonVariant } from "../pieces/pigeon";
import type { PicnicTable } from "../pieces/table";
import { restHandPosition, TOWARD_CAMERA_IN_WHALE } from "../pieces/whale";
import type { WhaleModel } from "../pieces/whale";
import { SCENE_FOCUS } from "../stage/look";
import { poseArm } from "./arm-rig";
import type { ArmRig } from "./arm-rig";
import { buildFeatherPool } from "./feathers";
import { buildFlipperShadow } from "./flipper-shadow";
import { createPigeonActor, printPigeonVariant } from "./pigeon-actor";
import type { PigeonActor, PigeonPose } from "./pigeon-actor";
import { BOX_ROW_DECK_Z, boxAlong, hoverSpot, perchSpot } from "./perches";
import type { PerchSpot } from "./perches";
import { createRoundDirector, PERCH_SLOT_COUNT } from "./round-director";
import type { FlightEnd, SeatPose } from "./round-director";
import { HAND_COCK_RAD, handCockAmount, makeRaisedHandPosition, slamHandPosition } from "./slam";
import type { HandPath } from "./slam";
import { createMoodGovernor, crowdedGlance, glanceTowardBox } from "./whale-mood";

const REPLAY_LEAD_S = 2.5;
const WHISTLE_S = 0.4;
const CRUMB_BITS_PER_BOX = 16;
const CRUMB_BITS_COUNTED_ONE_BY_ONE = 12;
const CRUMBS_PER_LATER_BIT = 5;
const CRUMB_BIT_SIZE_FACTOR = 1.6;
const REVEAL_PROP_DELAY_S = 0.08;
const ANGRY_AFTER_LANDING_MS = 400;
const SPOUT_MIN_HITS = 3;
const MISS_LOOK_MS = 600;
const CRUMB_FLIGHT_MIN_MS = 350;
const CRUMB_FLIGHT_SPREAD_MS = 250;
const CRUMB_LAUNCH_HEIGHT_UNITS = 2;
const CRUMB_ARC_PEAK_UNITS = 2.2;
const CRUMB_TUMBLE_RAD_PER_S = 1.5;
const FEATHERS_PER_HIT_MIN = 3;
const FEATHERS_PER_HIT_SPREAD = 3;
const LID_CONTACT_ABOVE_UNITS = 0.2;
const LID_CONTACT_BACK_SHARE = 0.35;
const STRUCK_BOX_FOCUS_HEIGHT_UNITS = 1.6;
const STRUCK_BOX_FOCUS_FRONT_UNITS = 1.4;
const FOCUS_FOLLOW_PER_S = 18;
const FOCUS_AT_BASE_UNITS = 0.01;

type ArmSide = "left" | "right";

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

interface ArmSlam {
  rig: ArmRig;
  path: HandPath;
  hand: THREE.Vector3;
  raise: HandRaisedEvent | null;
}

interface SeatActor {
  seat: number;
  actor: PigeonActor;
  hover: PerchSpot;
  shownSeatPose: SeatPose | null;
  shownPigeonPose: PigeonPose;
}

function armSideForBox(boxIndex: number, boxCount: number): ArmSide {
  return boxIndex >= boxCount - 1 ? "right" : "left";
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
  const outline = crumbOutline(P2.rng(611), CRUMB_BIT_SIZE_FACTOR);
  const materials = harness.printed(outline, paintCrumb);
  return Array.from({ length: boxCount }, (_unusedBox, boxIndex) => {
    const random = P2.rng(640 + boxIndex);
    return Array.from({ length: CRUMB_BITS_PER_BOX }, (_unusedBit, bitIndex): CrumbBit => {
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

function heightOf(end: FlightEnd): number {
  return end === "hover" ? HOVER_HEIGHT_UNITS : 0;
}

function buildArmSlam(rig: ArmRig): ArmSlam {
  return {
    rig,
    path: { rest: restHandPosition(rig.side), raised: makeRaisedHandPosition(rig.shoulder, rig.side), contact: new THREE.Vector3() },
    hand: new THREE.Vector3(),
    raise: null,
  };
}

export function buildReplayScene(harness: Harness, table: PicnicTable, whale: WhaleModel, boxes: readonly LunchboxModel[], round: RecordedRound): void {
  const { deck } = table;
  const { boxCount, tickMs } = round;
  const director = createRoundDirector(round);
  const order = table.table.order + 1.2;
  const printOptions = harness.cardOpts(0, 0, 1, deck);
  const kits = new Map<PigeonVariant, PigeonKit>();
  const cropBags = printCropBags(printOptions);
  const star = printStunStar(printOptions);
  const pressed = printPressedProps(printOptions);
  const perchSpots = Array.from({ length: boxCount }, (_unusedBox, boxIndex) =>
    Array.from({ length: PERCH_SLOT_COUNT }, (_unusedSlot, slot) => perchSpot(boxIndex, boxCount, slot)),
  );
  const seatActors: SeatActor[] = round.players.map((player, playerIndex) => {
    const variant = PIGEON_VARIANTS[player.variant % PIGEON_VARIANTS.length] ?? "gary";
    const kit = kits.get(variant) ?? printPigeonVariant(harness, deck, variant);
    kits.set(variant, kit);
    const actor = createPigeonActor(harness, deck, { kit, cropBags, star, pressed }, player.seat, order + playerIndex * 0.05);
    return { seat: player.seat, actor, hover: hoverSpot(playerIndex), shownSeatPose: null, shownPigeonPose: { kind: "hidden" } };
  });
  const actorBySeat = new Map(seatActors.map((entry) => [entry.seat, entry.actor]));
  const crumbBits = buildCrumbBits(harness, deck, boxCount, order + 2);
  const feathers = buildFeatherPool(printFeather(printOptions), printOptions, deck);
  const flipperShadow = buildFlipperShadow(harness, deck);
  const startingPot = startingPotOf(round);
  const revealBoxes = buildRevealBoxes(harness, deck, boxes, round, startingPot, order + 3);
  const moodGovernor = createMoodGovernor();
  const angryTicksAfterLanding = ANGRY_AFTER_LANDING_MS / tickMs;
  const settledTick = round.events.findLast((event) => event.kind === "settled")?.tick ?? Number.POSITIVE_INFINITY;
  const revealStartTick = settledTick + (WHISTLE_S * 1000) / tickMs;
  const lidStaggerTicks = (REVEAL_LID_STAGGER_S * 1000) / tickMs;
  const windupMs = round.timing.swatWindupTicks * tickMs;
  const baseTargetY = harness.target.y;
  const baseFocus = new THREE.Vector3(...SCENE_FOCUS);
  const armsBySide: Record<ArmSide, ArmSlam> = { left: buildArmSlam(whale.leftArm), right: buildArmSlam(whale.rightArm) };
  const arms: readonly ArmSlam[] = [armsBySide.left, armsBySide.right];
  const contactInDeck = new THREE.Vector3();
  const focusTarget = new THREE.Vector3();
  const cameraScratch = new THREE.Vector3();
  const boxScratch = new THREE.Vector3();
  const focusNow = baseFocus.clone();
  const stunMs = round.timing.swatStunTicks * tickMs;
  let revealOrder: RevealBox[] | null = null;
  let lastLanding: SwatLanding | null = null;
  let lastRaise: HandRaisedEvent | null = null;
  let earlierRaise: HandRaisedEvent | null = null;
  let previousPresentationTick: number | null = null;
  let missUntilMs = Number.NEGATIVE_INFINITY;
  let shownView: RoundViewState | null = null;
  let viewGlance = crowdedGlance(director.view(), boxCount);
  let isFocusPulled = false;

  function lidContactInDeck(boxIndex: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(boxAlong(boxIndex, boxCount), LUNCHBOX_HEIGHT_UNITS + LID_CONTACT_ABOVE_UNITS, BOX_ROW_DECK_Z - LUNCHBOX_DEPTH_UNITS * LID_CONTACT_BACK_SHARE);
  }

  function deckToWhale(pointInDeck: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    deck.updateWorldMatrix(true, false);
    whale.group.updateWorldMatrix(true, false);
    return whale.group.worldToLocal(deck.localToWorld(out.copy(pointInDeck)));
  }

  function perchSpotOf(end: FlightEnd, hover: PerchSpot): PerchSpot {
    return end === "hover" ? hover : (perchSpots[end.box]?.[end.slot % PERCH_SLOT_COUNT] ?? hover);
  }

  function toPigeonPose(pose: SeatPose, hover: PerchSpot): PigeonPose {
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
          from: perchSpotOf(pose.from, hover),
          to: perchSpotOf(pose.to, hover),
          fromHeight: heightOf(pose.from),
          toHeight: heightOf(pose.to),
          startTick: pose.startTick,
          landsTick: pose.landsTick,
        };
      case "perched":
        return { kind: "perched", spot: perchSpotOf(pose.at, hover) };
      case "stunned":
        return { kind: "stunned", spot: perchSpotOf(pose.at, hover), cause: pose.cause, sinceTick: pose.sinceTick, untilTick: pose.untilTick };
    }
  }

  function sortNearestFirst(reveals: readonly RevealBox[]): RevealBox[] {
    const cameraPosition = harness.camera.getWorldPosition(cameraScratch);
    return reveals
      .map((reveal) => ({ reveal, distance: reveal.box.node.getWorldPosition(boxScratch).distanceTo(cameraPosition) }))
      .sort((first, second) => first.distance - second.distance)
      .map(({ reveal }) => reveal);
  }

  function poseArms(nowTick: number): void {
    for (const arm of arms) {
      const msFromLanding = arm.raise ? (nowTick - arm.raise.landsTick) * tickMs : Number.POSITIVE_INFINITY;
      if (arm.raise) {
        deckToWhale(lidContactInDeck(arm.raise.box, contactInDeck), arm.path.contact);
        slamHandPosition(arm.path, msFromLanding, windupMs, arm.hand);
      } else {
        arm.hand.copy(arm.path.rest);
      }
      poseArm(arm.rig, arm.hand, TOWARD_CAMERA_IN_WHALE);
      arm.rig.fore.rotateZ(flipperShakeRad(msFromLanding));
      arm.rig.fore.rotateZ(arm.rig.side * HAND_COCK_RAD * handCockAmount(msFromLanding, windupMs));
    }
    whale.whale.sway = lastRaise ? -torsoLeanRad((nowTick - lastRaise.landsTick) * tickMs, windupMs) : 0;
  }

  function focusPullOf(raise: HandRaisedEvent | null, nowTick: number): number {
    return raise ? focusPullAmount((nowTick - raise.landsTick) * tickMs, windupMs, stunMs) : 0;
  }

  function stageStruckBox(nowTick: number, dtSeconds: number): void {
    const msFromLanding = lastRaise ? (nowTick - lastRaise.landsTick) * tickMs : Number.POSITIVE_INFINITY;
    if (lastRaise && isFlipperShadowShown(msFromLanding, windupMs)) {
      flipperShadow.show(lidContactInDeck(lastRaise.box, contactInDeck), flipperShadowHeightUnits(msFromLanding, windupMs));
    } else {
      flipperShadow.hide();
    }
    const focusRaise = focusPullOf(earlierRaise, nowTick) > focusPullOf(lastRaise, nowTick) ? earlierRaise : lastRaise;
    const pull = focusPullOf(focusRaise, nowTick);
    if (focusRaise && pull > 0) {
      deck.updateWorldMatrix(true, false);
      deck.localToWorld(focusTarget.set(boxAlong(focusRaise.box, boxCount), STRUCK_BOX_FOCUS_HEIGHT_UNITS, BOX_ROW_DECK_Z + STRUCK_BOX_FOCUS_FRONT_UNITS));
      focusTarget.lerpVectors(baseFocus, focusTarget, pull);
    } else {
      focusTarget.copy(baseFocus);
    }
    focusNow.lerp(focusTarget, 1 - Math.exp(-dtSeconds * FOCUS_FOLLOW_PER_S));
    const isAtBase = focusNow.distanceToSquared(baseFocus) < FOCUS_AT_BASE_UNITS * FOCUS_AT_BASE_UNITS;
    if (!isAtBase || pull > 0) harness.focusOn(focusNow);
    else if (isFocusPulled) harness.focusOn(null);
    isFocusPulled = !isAtBase || pull > 0;
  }

  function hitPerchSpot(seat: number, tick: number): PerchSpot | null {
    const pose = director.poseOf(seat, tick);
    if (pose.kind !== "stunned" && pose.kind !== "perched") return null;
    return perchSpots[pose.at.box]?.[pose.at.slot % PERCH_SLOT_COUNT] ?? null;
  }

  function launchFeathers(landing: SwatLanding, swatNumber: number): void {
    for (const [hitIndex, hitSeat] of landing.hitSeats.entries()) {
      const from = hitPerchSpot(hitSeat, landing.tick);
      if (!from) continue;
      const featherCount = FEATHERS_PER_HIT_MIN + ((hitSeat + swatNumber) % FEATHERS_PER_HIT_SPREAD);
      for (let featherIndex = 0; featherIndex < featherCount; featherIndex++) {
        feathers.launch(from.along, from.deckZ, landing.tick, landing.tick * 31 + hitIndex * 7 + featherIndex);
      }
    }
  }

  function launchCrumb(bit: CrumbBit, bitIndex: number, landing: SwatLanding): void {
    const hitSeat = landing.hitSeats[bitIndex % Math.max(1, landing.hitSeats.length)];
    const from = hitSeat === undefined ? null : hitPerchSpot(hitSeat, landing.tick);
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
    for (const [boxIndex, bits] of crumbBits.entries()) {
      const shownCount = crumbBitCount(looseCrumbs[boxIndex] ?? 0);
      const landing = lastLanding && lastLanding.box === boxIndex && nowTick - lastLanding.tick < (hitStopMs(lastLanding.hitCount) + CRUMB_FLIGHT_MIN_MS) / tickMs ? lastLanding : null;
      for (const [bitIndex, bit] of bits.entries()) {
        const shouldShow = bitIndex < shownCount;
        if (shouldShow && !bit.isShown) {
          if (landing) {
            bit.piece.reset(1);
            launchCrumb(bit, bitIndex, landing);
          } else {
            bit.piece.reset(0);
            bit.piece.set(1, 0);
          }
        }
        if (!shouldShow) bit.flight = null;
        bit.isShown = shouldShow;
        bit.piece.group.visible = shouldShow;
        if (shouldShow) placeCrumb(bit, presentTick);
      }
    }
  }

  function playImpact(presentTick: number, nowTick: number): void {
    const landing = lastLanding;
    const releaseTick = landing ? landing.tick + hitStopMs(landing.hitCount) / tickMs : Number.POSITIVE_INFINITY;
    const impactMs = landing && nowTick >= releaseTick ? (presentTick - landing.tick) * tickMs : -1;
    table.table.sway = deckDipRad(impactMs);
    harness.target.y = baseTargetY - cameraDropUnits(impactMs);
    for (const [boxIndex, box] of boxes.entries()) {
      const isStruck = landing !== null && boxIndex === landing.box;
      const distance = landing ? Math.abs(boxAlong(boxIndex, boxCount) - boxAlong(landing.box, boxCount)) : 0;
      box.piece.sway = landing && !isStruck ? boxHopRad(impactMs, distance) : 0;
      if (presentTick < revealStartTick) box.setLidOpen(isStruck ? lidPopAmount(impactMs) : 0);
    }
    if (!landing || impactMs < 0 || landing.hasFlinched) return;
    landing.hasFlinched = true;
    for (const { seat, actor } of seatActors) {
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
    for (const [rank, reveal] of revealOrder.entries()) {
      if (!reveal.hasOpened && nowTick >= revealStartTick + rank * lidStaggerTicks) {
        reveal.hasOpened = true;
        reveal.lidSpring.set(1);
        reveal.prop.reset(0);
        reveal.prop.set(1, REVEAL_PROP_DELAY_S);
      }
      reveal.prop.group.visible = reveal.hasOpened;
      reveal.box.setLidOpen(reveal.lidSpring.step(dtSeconds));
    }
  }

  function actFace(nowTick: number, nowMs: number, dtSeconds: number, view: RoundViewState): void {
    const isAngry = lastRaise !== null && nowTick >= lastRaise.tick && nowTick < lastRaise.landsTick + angryTicksAfterLanding;
    const potShare = startingPot > 0 && view.phase !== "lobby" ? view.pot / startingPot : 1;
    const missedBox = lastLanding && nowMs < missUntilMs ? lastLanding.box : null;
    if (missedBox !== null) whale.face.setMood("alert", glanceTowardBox(missedBox, boxCount));
    else whale.face.setMood(isAngry ? "angry" : moodGovernor.moodAt(potShare, nowMs), viewGlance);
    whale.face.step(dtSeconds, nowMs);
  }

  function showViewChanges(view: RoundViewState): void {
    if (view === shownView) return;
    shownView = view;
    viewGlance = crowdedGlance(view, boxCount);
    for (const seatView of view.seats) actorBySeat.get(seatView.seat)?.showBeakCrumbs(seatView.beakCrumbs);
  }

  harness.onRestart(() => {
    director.reset();
    moodGovernor.reset();
    whale.face.reset();
    revealOrder = null;
    lastLanding = null;
    lastRaise = null;
    earlierRaise = null;
    for (const arm of arms) arm.raise = null;
    previousPresentationTick = null;
    missUntilMs = Number.NEGATIVE_INFINITY;
    shownView = null;
    harness.target.y = baseTargetY;
    harness.focusOn(null);
    focusNow.copy(baseFocus);
    isFocusPulled = false;
    flipperShadow.hide();
    feathers.reset();
    table.table.sway = 0;
    whale.whale.sway = 0;
    for (const box of boxes) box.piece.sway = 0;
    for (const entry of seatActors) {
      entry.actor.reset();
      entry.shownSeatPose = null;
    }
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
      if (event.kind === "handRaised") {
        earlierRaise = lastRaise;
        lastRaise = event;
        armsBySide[armSideForBox(event.box, boxCount)].raise = event;
      }
      if (event.kind === "swatLanded") {
        lastLanding = { tick: event.tick, hitCount: event.hits.length, box: event.box, hitSeats: event.hits.map((hit) => hit.seat), hasFlinched: false };
        launchFeathers(lastLanding, event.swatNumber);
        if (event.hits.length >= SPOUT_MIN_HITS) whale.face.popSpout(event.tick * tickMs);
        if (event.hits.length === 0) missUntilMs = event.tick * tickMs + MISS_LOOK_MS;
      }
    }
    const presentTick = presentationTick(nowTick, lastLanding, tickMs);
    const presentDt = previousPresentationTick === null ? dtSeconds : Math.max(0, ((presentTick - previousPresentationTick) * tickMs) / 1000);
    previousPresentationTick = presentTick;
    const view = director.view();
    showViewChanges(view);
    for (const entry of seatActors) {
      const seatPose = director.poseOf(entry.seat, presentTick);
      if (seatPose !== entry.shownSeatPose) {
        entry.shownSeatPose = seatPose;
        entry.shownPigeonPose = toPigeonPose(seatPose, entry.hover);
      }
      entry.actor.update(entry.shownPigeonPose, presentTick, tickMs, presentDt);
    }
    poseArms(presentTick);
    stageStruckBox(presentTick, presentDt);
    actFace(presentTick, presentTick * tickMs, presentDt, view);
    showCrumbs(view.looseCrumbs, presentTick, nowTick);
    feathers.place(presentTick, tickMs);
    playImpact(presentTick, nowTick);
    playReveal(presentTick, presentDt);
  });
}
