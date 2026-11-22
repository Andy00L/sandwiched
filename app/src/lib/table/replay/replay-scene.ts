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
import { PIGEON_VARIANTS } from "../pieces/pigeon";
import type { PigeonVariant } from "../pieces/pigeon";
import type { PicnicTable } from "../pieces/table";
import { restHandPosition, TOWARD_CAMERA_IN_WHALE } from "../pieces/whale";
import type { WhaleModel } from "../pieces/whale";
import { poseArm } from "./arm-rig";
import type { ArmRig } from "./arm-rig";
import { createPigeonActor, printPigeonVariant } from "./pigeon-actor";
import type { PigeonActor, PigeonPose, PigeonPrint } from "./pigeon-actor";
import { BOX_ROW_DECK_Z, boxAlong, hoverSpot, perchSpot } from "./perches";
import type { PerchSpot } from "./perches";
import { createRoundDirector } from "./round-director";
import type { FlightEnd, SeatPose } from "./round-director";
import { raisedHandPosition, slamHandPosition } from "./slam";

const REPLAY_LEAD_S = 2.5;
const WHISTLE_S = 0.4;
const CRUMB_BITS_PER_BOX = 16;
const CRUMB_BITS_COUNTED_ONE_BY_ONE = 12;
const CRUMBS_PER_LATER_BIT = 5;
const REVEAL_PROP_DELAY_S = 0.08;

interface CrumbBit {
  piece: PlacedPiece;
  isShown: boolean;
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

function biteStageAtSettlement(round: RecordedRound): number {
  const draw = round.events.find((event) => event.kind === "whaleDrawn");
  const lastTick = round.events.at(-1)?.tick ?? 0;
  const startingPot = viewStateAt(round, draw?.tick ?? lastTick).pot;
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
      const piece = harness.popup(outline, null, {
        materials,
        parent: deck,
        x: boxAlong(boxIndex, boxCount) + (random() * 2 - 1) * (LUNCHBOX_WIDTH_UNITS / 2 + 0.8),
        z: BOX_ROW_DECK_Z + 0.3 + random() * 1.5,
        yaw: (random() - 0.5) * 1.2,
        order: order + bitIndex * 0.01,
      });
      piece.group.visible = false;
      return { piece, isShown: false };
    });
  });
}

function buildRevealBoxes(harness: Harness, deck: THREE.Object3D, boxes: readonly LunchboxModel[], round: RecordedRound, order: number): RevealBox[] {
  const sandwichBox = round.events.find((event) => event.kind === "whaleDrawn")?.sandwichBox ?? null;
  const [mothOutline, paintMoth] = mothCard();
  const mothMaterials = harness.printed(mothOutline, paintMoth);
  const [sandwichOutline, paintSandwich] = sandwichCard(biteStageAtSettlement(round));
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
  const prints = new Map<PigeonVariant, PigeonPrint>();
  const actors = round.players.map((player, playerIndex) => {
    const variant = PIGEON_VARIANTS[player.variant % PIGEON_VARIANTS.length] ?? "gary";
    const print = prints.get(variant) ?? printPigeonVariant(harness, deck, variant);
    prints.set(variant, print);
    const actor: PigeonActor = createPigeonActor(harness, deck, print, player.seat, order + playerIndex * 0.05);
    return { seat: player.seat, actor, hover: hoverSpot(playerIndex, round.players.length) };
  });
  const actorBySeat = new Map(actors.map((entry) => [entry.seat, entry.actor]));
  const crumbBits = buildCrumbBits(harness, deck, boxCount, order + 2);
  const revealBoxes = buildRevealBoxes(harness, deck, boxes, round, order + 3);
  const settledTick = round.events.findLast((event) => event.kind === "settled")?.tick ?? Number.POSITIVE_INFINITY;
  const revealStartTick = settledTick + (WHISTLE_S * 1000) / tickMs;
  const lidStaggerTicks = (REVEAL_LID_STAGGER_S * 1000) / tickMs;
  const windupMs = round.timing.swatWindupTicks * tickMs;
  let revealOrder: RevealBox[] | null = null;

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
      const hand = raise
        ? slamHandPosition(
            { rest, raised: raisedHandPosition(rig.shoulder, rig.side), contact: lidContactLocal(deck, whale.group, raise.box, boxCount) },
            (nowTick - raise.landsTick) * tickMs,
            windupMs,
          )
        : rest;
      poseArm(rig, hand, TOWARD_CAMERA_IN_WHALE);
    }
  }

  function showCrumbs(looseCrumbs: readonly number[]): void {
    crumbBits.forEach((bits, boxIndex) => {
      const shownCount = crumbBitCount(looseCrumbs[boxIndex] ?? 0);
      bits.forEach((bit, bitIndex) => {
        const shouldShow = bitIndex < shownCount;
        if (shouldShow && !bit.isShown) {
          bit.piece.reset(0);
          bit.piece.set(1, 0);
        }
        bit.isShown = shouldShow;
        bit.piece.group.visible = shouldShow;
      });
    });
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

  harness.onRestart(() => {
    director.reset();
    revealOrder = null;
    for (const { actor } of actors) actor.reset();
    for (const bits of crumbBits) for (const bit of bits) bit.isShown = false;
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
    }
    for (const { seat, actor, hover } of actors) actor.update(toPigeonPose(director.poseOf(seat, nowTick), hover, boxCount), nowTick, tickMs, dtSeconds);
    poseArms(nowTick);
    showCrumbs(director.view().looseCrumbs);
    playReveal(nowTick, dtSeconds);
  });
}
