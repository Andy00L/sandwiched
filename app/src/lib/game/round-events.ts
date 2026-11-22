export const ROUND_SCHEMA_VERSION = 1;

export type Temperament = "greedy" | "nervous" | "vulture";

export type RoundTiming = {
  lobbyTicks: number;
  drawTimeoutTicks: number;
  hideTicks: number;
  roundTicks: number;
  flightTicks: number;
  peckCooldownTicks: number;
  emptyBoxStunTicks: number;
  swatWindupTicks: number;
  swatCooldownTicks: number;
  swatStunTicks: number;
  switchCooldownTicks: number;
};

export type RoundPlayer = {
  seat: number;
  name: string;
  variant: number;
  temperament: Temperament;
};

export type SwatHit = { seat: number; droppedCrumbs: number; untilTick: number };

export type SeatCrumbs = { seat: number; crumbs: number };

export type SeatJoinedEvent = { tick: number; kind: "seatJoined"; seat: number };
export type AntedEvent = { tick: number; kind: "anted"; seat: number };
export type WhaleDrawnEvent = {
  tick: number;
  kind: "whaleDrawn";
  whaleSeat: number;
  sandwichBox: number;
  endTick: number;
};
export type FlewEvent = { tick: number; kind: "flew"; seat: number; box: number; landsTick: number };
export type LandedEvent = { tick: number; kind: "landed"; seat: number; box: number };
export type TookOffEvent = { tick: number; kind: "tookOff"; seat: number };
export type PeckedEvent = { tick: number; kind: "pecked"; seat: number; box: number } & (
  | { outcome: "looseCrumb" | "sandwichCrumb" }
  | { outcome: "emptyBox"; untilTick: number }
);
export type HandRaisedEvent = {
  tick: number;
  kind: "handRaised";
  box: number;
  swatNumber: number;
  landsTick: number;
};
export type SwatLandedEvent = {
  tick: number;
  kind: "swatLanded";
  box: number;
  swatNumber: number;
  hits: readonly SwatHit[];
};
export type StunEndedEvent = { tick: number; kind: "stunEnded"; seat: number };
export type SettledEvent = {
  tick: number;
  kind: "settled";
  whaleCrumbs: number;
  pigeonCrumbs: number;
  beaks: readonly SeatCrumbs[];
};

export type RoundEvent =
  | SeatJoinedEvent
  | AntedEvent
  | WhaleDrawnEvent
  | FlewEvent
  | LandedEvent
  | TookOffEvent
  | PeckedEvent
  | HandRaisedEvent
  | SwatLandedEvent
  | StunEndedEvent
  | SettledEvent;

export type RoundEventKind = RoundEvent["kind"];

export type RecordedRound = {
  version: typeof ROUND_SCHEMA_VERSION;
  seed: number;
  tickMs: number;
  boxCount: number;
  timing: RoundTiming;
  chipsPerAnte: number;
  players: readonly RoundPlayer[];
  events: readonly RoundEvent[];
};

export type RoundParseResult = { ok: true; round: RecordedRound } | { ok: false; reason: string };

type Parsed<Value> = { ok: true; value: Value } | { ok: false; reason: string };

type UnknownRecord = Readonly<Record<string, unknown>>;

const TEMPERAMENTS = ["greedy", "nervous", "vulture"] as const satisfies readonly Temperament[];
const PECK_OUTCOMES = ["looseCrumb", "sandwichCrumb", "emptyBox"] as const;
const EVENT_KINDS = [
  "seatJoined",
  "anted",
  "whaleDrawn",
  "flew",
  "landed",
  "tookOff",
  "pecked",
  "handRaised",
  "swatLanded",
  "stunEnded",
  "settled",
] as const satisfies readonly RoundEventKind[];
const VARIANT_COUNT = 6;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createFieldReader(source: UnknownRecord, path: string) {
  let failure: string | null = null;
  const recordFailure = (key: string, expectation: string) => {
    failure ??= `${path}.${key} ${expectation}`;
  };
  return {
    count(key: string): number {
      const value = source[key];
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
        return value;
      }
      recordFailure(key, "must be a whole number of at least 0");
      return 0;
    },
    text(key: string): string {
      const value = source[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
      recordFailure(key, "must be a non-empty string");
      return "";
    },
    choice<Option extends string>(key: string, options: readonly [Option, ...Option[]]): Option {
      const value = source[key];
      const match = options.find((option) => option === value);
      if (match !== undefined) {
        return match;
      }
      recordFailure(key, `must be one of ${options.join(", ")}`);
      return options[0];
    },
    list<Item>(key: string, readItem: (item: unknown, itemPath: string) => Parsed<Item>): Item[] {
      const value: unknown = source[key];
      if (!Array.isArray(value)) {
        recordFailure(key, "must be a list");
        return [];
      }
      const entries: readonly unknown[] = value;
      const items: Item[] = [];
      for (const [index, entry] of entries.entries()) {
        const parsed = readItem(entry, `${path}.${key}[${index}]`);
        if (!parsed.ok) {
          failure ??= parsed.reason;
          return [];
        }
        items.push(parsed.value);
      }
      return items;
    },
    failure(): string | null {
      return failure;
    },
  };
}

type FieldReader = ReturnType<typeof createFieldReader>;

function readObject<Value>(
  value: unknown,
  path: string,
  readFields: (fields: FieldReader) => Value,
): Parsed<Value> {
  if (!isRecord(value)) {
    return { ok: false, reason: `${path} must be an object` };
  }
  const fields = createFieldReader(value, path);
  const parsed = readFields(fields);
  const failure = fields.failure();
  return failure === null ? { ok: true, value: parsed } : { ok: false, reason: failure };
}

function readTiming(value: unknown, path: string): Parsed<RoundTiming> {
  return readObject(value, path, (fields) => ({
    lobbyTicks: fields.count("lobbyTicks"),
    drawTimeoutTicks: fields.count("drawTimeoutTicks"),
    hideTicks: fields.count("hideTicks"),
    roundTicks: fields.count("roundTicks"),
    flightTicks: fields.count("flightTicks"),
    peckCooldownTicks: fields.count("peckCooldownTicks"),
    emptyBoxStunTicks: fields.count("emptyBoxStunTicks"),
    swatWindupTicks: fields.count("swatWindupTicks"),
    swatCooldownTicks: fields.count("swatCooldownTicks"),
    swatStunTicks: fields.count("swatStunTicks"),
    switchCooldownTicks: fields.count("switchCooldownTicks"),
  }));
}

function readPlayer(value: unknown, path: string): Parsed<RoundPlayer> {
  return readObject(value, path, (fields) => ({
    seat: fields.count("seat"),
    name: fields.text("name"),
    variant: fields.count("variant"),
    temperament: fields.choice("temperament", TEMPERAMENTS),
  }));
}

function readSwatHit(value: unknown, path: string): Parsed<SwatHit> {
  return readObject(value, path, (fields) => ({
    seat: fields.count("seat"),
    droppedCrumbs: fields.count("droppedCrumbs"),
    untilTick: fields.count("untilTick"),
  }));
}

function readSeatCrumbs(value: unknown, path: string): Parsed<SeatCrumbs> {
  return readObject(value, path, (fields) => ({
    seat: fields.count("seat"),
    crumbs: fields.count("crumbs"),
  }));
}

function readEvent(value: unknown, path: string): Parsed<RoundEvent> {
  return readObject(value, path, (fields) =>
    readEventFields(fields.choice("kind", EVENT_KINDS), fields.count("tick"), fields),
  );
}

function readEventFields(kind: RoundEventKind, tick: number, fields: FieldReader): RoundEvent {
  switch (kind) {
    case "seatJoined":
    case "anted":
    case "tookOff":
    case "stunEnded":
      return { tick, kind, seat: fields.count("seat") };
    case "whaleDrawn":
      return {
        tick,
        kind,
        whaleSeat: fields.count("whaleSeat"),
        sandwichBox: fields.count("sandwichBox"),
        endTick: fields.count("endTick"),
      };
    case "flew":
      return {
        tick,
        kind,
        seat: fields.count("seat"),
        box: fields.count("box"),
        landsTick: fields.count("landsTick"),
      };
    case "landed":
      return { tick, kind, seat: fields.count("seat"), box: fields.count("box") };
    case "pecked": {
      const seat = fields.count("seat");
      const box = fields.count("box");
      const outcome = fields.choice("outcome", PECK_OUTCOMES);
      return outcome === "emptyBox"
        ? { tick, kind, seat, box, outcome, untilTick: fields.count("untilTick") }
        : { tick, kind, seat, box, outcome };
    }
    case "handRaised":
      return {
        tick,
        kind,
        box: fields.count("box"),
        swatNumber: fields.count("swatNumber"),
        landsTick: fields.count("landsTick"),
      };
    case "swatLanded":
      return {
        tick,
        kind,
        box: fields.count("box"),
        swatNumber: fields.count("swatNumber"),
        hits: fields.list("hits", readSwatHit),
      };
    case "settled":
      return {
        tick,
        kind,
        whaleCrumbs: fields.count("whaleCrumbs"),
        pigeonCrumbs: fields.count("pigeonCrumbs"),
        beaks: fields.list("beaks", readSeatCrumbs),
      };
  }
}

function listEventSeats(event: RoundEvent): readonly number[] {
  switch (event.kind) {
    case "whaleDrawn":
      return [event.whaleSeat];
    case "swatLanded":
      return event.hits.map((hit) => hit.seat);
    case "settled":
      return event.beaks.map((beak) => beak.seat);
    case "handRaised":
      return [];
    case "seatJoined":
    case "anted":
    case "flew":
    case "landed":
    case "tookOff":
    case "pecked":
    case "stunEnded":
      return [event.seat];
  }
}

function readEventBox(event: RoundEvent): number | null {
  switch (event.kind) {
    case "whaleDrawn":
      return event.sandwichBox;
    case "flew":
    case "landed":
    case "pecked":
    case "handRaised":
    case "swatLanded":
      return event.box;
    case "seatJoined":
    case "anted":
    case "tookOff":
    case "stunEnded":
    case "settled":
      return null;
  }
}

function findInconsistency(round: RecordedRound): string | null {
  if (round.tickMs === 0) {
    return "round.tickMs must be above 0";
  }
  if (round.boxCount === 0) {
    return "round.boxCount must be above 0";
  }
  if (round.players.length === 0) {
    return "round.players must not be empty";
  }
  const seats = new Set(round.players.map((player) => player.seat));
  if (seats.size !== round.players.length) {
    return "round.players has a seat twice";
  }
  const oddVariant = round.players.find((player) => player.variant >= VARIANT_COUNT);
  if (oddVariant !== undefined) {
    return `round.players seat ${oddVariant.seat} has variant ${oddVariant.variant}, above ${VARIANT_COUNT - 1}`;
  }
  let previousTick = 0;
  for (const [index, event] of round.events.entries()) {
    if (event.tick < previousTick) {
      return `round.events[${index}] at tick ${event.tick} comes after tick ${previousTick}`;
    }
    previousTick = event.tick;
    const strangerSeat = listEventSeats(event).find((seat) => !seats.has(seat));
    if (strangerSeat !== undefined) {
      return `round.events[${index}] names seat ${strangerSeat}, which is not at the table`;
    }
    const box = readEventBox(event);
    if (box !== null && box >= round.boxCount) {
      return `round.events[${index}] names box ${box}, but the table has ${round.boxCount}`;
    }
  }
  return null;
}

export function parseRecordedRound(json: unknown): RoundParseResult {
  if (!isRecord(json)) {
    return { ok: false, reason: "round must be an object" };
  }
  const fields = createFieldReader(json, "round");
  const version = fields.count("version");
  const seed = fields.count("seed");
  const tickMs = fields.count("tickMs");
  const boxCount = fields.count("boxCount");
  const chipsPerAnte = fields.count("chipsPerAnte");
  const players = fields.list("players", readPlayer);
  const events = fields.list("events", readEvent);
  const failure = fields.failure();
  if (failure !== null) {
    return { ok: false, reason: failure };
  }
  if (version !== ROUND_SCHEMA_VERSION) {
    return { ok: false, reason: `round.version ${version} is not ${ROUND_SCHEMA_VERSION}` };
  }
  const timing = readTiming(json["timing"], "round.timing");
  if (!timing.ok) {
    return { ok: false, reason: timing.reason };
  }
  const round: RecordedRound = {
    version,
    seed,
    tickMs,
    boxCount,
    timing: timing.value,
    chipsPerAnte,
    players,
    events,
  };
  const inconsistency = findInconsistency(round);
  return inconsistency === null ? { ok: true, round } : { ok: false, reason: inconsistency };
}
