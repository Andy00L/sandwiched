import type { Harness } from "papercraft/harness.js";
import { createLife } from "papercraft/lib/paper-life.js";
import { placeOnTable } from "../layout";
import { KRAFT_INKS, PALETTE } from "../palette";
import { ambientPigeonCard } from "../pieces/pigeon";
import { PIGEON_HEIGHT_UNITS } from "./look";

const AMBIENT_PIGEON_SCALE = 0.8;
const AMBIENT_PIGEON_HOMES: ReadonlyArray<readonly [number, number]> = [
  placeOnTable([-19, 0]),
  placeOnTable([19.5, -3]),
  placeOnTable([12, 11]),
  placeOnTable([-12.5, 17]),
  placeOnTable([-21, 9]),
  placeOnTable([22, 8]),
  placeOnTable([3, 16]),
];
const LEAF_COLOURS = [PALETTE.mustard, PALETTE.shadowTint, KRAFT_INKS.wood, PALETTE.kraftWoodDark];

export function buildParkLife(harness: Harness): void {
  const life = createLife({ scene: harness.scene, camera: harness.camera, heroHeight: PIGEON_HEIGHT_UNITS, seed: 11, wind: [0.94, 0.34] });
  life.fallers({ count: 28, cut: "leaf", colors: LEAF_COLOURS, size: [0.24, 0.34], fall: [0.7, 1.2], land: 9 });
  life.cloudShadows({ count: 4, size: [13, 22], alpha: 0.15, speed: 0.6 });
  const [outline, paint] = ambientPigeonCard();
  const materials = harness.printed(outline, paint);
  for (const [homeX, homeZ] of AMBIENT_PIGEON_HOMES) {
    const pigeon = harness.popup(outline, null, { materials, x: homeX, z: homeZ, scale: AMBIENT_PIGEON_SCALE });
    life.critter(pigeon.group, { behaviour: "peck", home: [homeX, homeZ], roam: 1.4 });
  }
  harness.onStep((_timeSeconds, dtSeconds) => life.update(dtSeconds, harness.target));
  harness.onRestart(() => life.reset(harness.target));
}
