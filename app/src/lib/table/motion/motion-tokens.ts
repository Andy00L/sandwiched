import { PIGEON_HEIGHT_UNITS } from "../stage/look";

export const PECK_STRIKE_MS = 70;
export const PECK_RECOVER_MS = 110;
export const PECK_TILT_RAD = 0.42;

export const BONK_TILT_RAD = 1.55;

export const FLATTEN_MS = 80;

export const HIT_STOP_BASE_MS = 50;
export const HIT_STOP_PER_HIT_MS = 15;
export const HIT_STOP_MAX_MS = 110;
export const RIPPLE_S_PER_UNIT = 0.02;
export const FLINCH_MS = 120;
export const SWAT_STAR_FOLD_MS = 500;

export const SLAM_RAISE_MS = 180;
const SLAM_HOLD_AT_TOP_MS = 110;
export const SLAM_DOWN_MS = 60;
export const SLAM_HOLD_MS = 150;
export const SLAM_LIFT_MS = 250;

export const FOCUS_PULL_MS = SLAM_HOLD_AT_TOP_MS;
export const FOCUS_RETURN_MS = 600;

export const FEATHER_DRIFT_MS = 1200;
export const CREASE_MS = 2000;

export const FLIGHT_ARC_HEIGHT_UNITS = 0.9 * PIGEON_HEIGHT_UNITS;
export const HOVER_HEIGHT_UNITS = 0.9 * PIGEON_HEIGHT_UNITS;
export const HOVER_BOB_UNITS = 0.03 * PIGEON_HEIGHT_UNITS;
export const HOVER_BOB_HZ = 1.6;

export const REVEAL_LID_STAGGER_S = 0.12;

export const TIMER_WEDGE_S = 10;
export const TIMER_KICK_RAD = (2 * Math.PI) / 180;
export const TIMER_KICK_DECAY_MS = 140;
