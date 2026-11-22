use crate::bots::{
    choose_pigeon_move, choose_swat_box, PigeonMove, PigeonSituation, TableView, Temperament,
    TEMPERAMENTS,
};
use crate::events::{
    PeckResult, PlayerEntry, RecordedRound, RoundEvent, RoundHeader, SeatCrumbs, SwatHit,
    TimedEvent, SCHEMA_VERSION,
};
use crate::random::SeededRandom;
use sandwich_rules::constants::{CHIPS_PER_ANTE, MAX_BOXES};
use sandwich_rules::{
    can_start_round, pick_default_box, pick_whale, Hand, MoveOutcome, PeckOutcome, Pigeon,
    PigeonState, Round, RuleError, Timing,
};

pub const TICK_MS: u64 = 10;
const BOX_COUNT: u8 = MAX_BOXES as u8;
const REACTION_MIN_MS: u64 = 150;
const REACTION_MAX_MS: u64 = 450;
const JOIN_GAP_MIN_MS: u64 = 100;
const JOIN_GAP_MAX_MS: u64 = 400;
const VRF_ANSWER_MS: u64 = 100;
const PIGEON_NAMES: [&str; 6] = ["Gary", "Linda", "Doug", "Brenda", "Keith", "Sheila"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RoundConfig {
    pub players: u8,
    pub seed: u64,
    pub timing: Timing,
}

pub fn standard_timing() -> Result<Timing, SimulationError> {
    Timing::from_tick_ms(TICK_MS).map_err(|error| rule_failure("timing", 0, error))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SimulationError {
    Rule { step: &'static str, tick: u64, error: RuleError },
    ChipsNotConserved { tick: u64, expected: u64, found: Option<u64> },
    LateSwat { seat: u8, tick: u64 },
    UnexpectedPigeonState { seat: u8, tick: u64 },
}

impl core::fmt::Display for SimulationError {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            SimulationError::Rule { step, tick, error } => {
                write!(formatter, "the rules refused {step} at tick {tick}: {error:?}")
            }
            SimulationError::ChipsNotConserved { tick, expected, found } => write!(
                formatter,
                "chips not conserved at tick {tick}: expected {expected}, found {found:?}"
            ),
            SimulationError::LateSwat { seat, tick } => write!(
                formatter,
                "seat {seat} met a swat at tick {tick} that should have been applied at its landing"
            ),
            SimulationError::UnexpectedPigeonState { seat, tick } => {
                write!(formatter, "seat {seat} is in an unexpected state at tick {tick}")
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SeatPlan {
    seat: u8,
    temperament: Temperament,
    reaction_ticks: u64,
}

struct Lobby {
    events: Vec<TimedEvent>,
    first_ante_tick: u64,
    last_ante_tick: u64,
}

struct LiveTable {
    timing: Timing,
    round: Round,
    start_tick: u64,
    whale: SeatPlan,
    pigeon_plans: Vec<SeatPlan>,
    pigeons: Vec<Pigeon>,
    views: Vec<TableView>,
    last_crumb_box: Option<u8>,
    events: Vec<TimedEvent>,
}

pub fn simulate_round(config: RoundConfig) -> Result<RecordedRound, SimulationError> {
    let timing = config.timing;
    let mut random = SeededRandom::from_seed(config.seed);
    let seat_plans = plan_seats(config.players, &mut random);
    let lobby = play_lobby(&seat_plans, &mut random);
    let draw_tick = lobby.last_ante_tick;
    can_start_round(
        config.players,
        config.players,
        lobby.first_ante_tick,
        draw_tick,
        &timing,
    )
    .map_err(|error| rule_failure("start_round", draw_tick, error))?;
    let start_tick = draw_tick + ticks_from_ms(VRF_ANSWER_MS);
    let randomness = random.vrf_randomness();
    let whale_seat = pick_whale(&randomness, config.players)
        .map_err(|error| rule_failure("pick_whale", start_tick, error))?;
    let sandwich_box = pick_default_box(&randomness, BOX_COUNT)
        .map_err(|error| rule_failure("pick_default_box", start_tick, error))?;
    let round = Round::start(BOX_COUNT, sandwich_box, config.players, start_tick, &timing)
        .map_err(|error| rule_failure("start", start_tick, error))?;
    let whale = seat_plans
        .iter()
        .copied()
        .find(|plan| plan.seat == whale_seat)
        .ok_or(SimulationError::UnexpectedPigeonState { seat: whale_seat, tick: start_tick })?;
    let pigeon_plans: Vec<SeatPlan> =
        seat_plans.iter().copied().filter(|plan| plan.seat != whale_seat).collect();
    let table = LiveTable {
        timing,
        round,
        start_tick,
        whale,
        pigeons: vec![Pigeon::at_round_start(); pigeon_plans.len()],
        pigeon_plans,
        views: Vec::new(),
        last_crumb_box: None,
        events: lobby.events,
    };
    let events = table.play()?;
    Ok(RecordedRound {
        header: RoundHeader {
            version: SCHEMA_VERSION,
            seed: config.seed,
            tick_ms: TICK_MS,
            box_count: BOX_COUNT,
            timing: timing.into(),
            chips_per_ante: CHIPS_PER_ANTE,
            players: seat_plans.iter().map(player_entry).collect(),
        },
        events,
    })
}

fn plan_seats(players: u8, random: &mut SeededRandom) -> Vec<SeatPlan> {
    (0..players)
        .map(|seat| {
            let temperament_index = random.value_between(0, TEMPERAMENTS.len() as u64 - 1);
            let temperament = usize::try_from(temperament_index)
                .ok()
                .and_then(|index| TEMPERAMENTS.get(index).copied())
                .unwrap_or(Temperament::Greedy);
            let reaction_ms = random.value_between(REACTION_MIN_MS, REACTION_MAX_MS);
            SeatPlan { seat, temperament, reaction_ticks: ticks_from_ms(reaction_ms) }
        })
        .collect()
}

fn play_lobby(seat_plans: &[SeatPlan], random: &mut SeededRandom) -> Lobby {
    let mut events = Vec::with_capacity(seat_plans.len() * 2);
    let mut join_tick = 0;
    let mut first_ante_tick = u64::MAX;
    let mut last_ante_tick = 0;
    for plan in seat_plans {
        let ante_tick = join_tick + plan.reaction_ticks;
        events.push(TimedEvent { tick: join_tick, event: RoundEvent::SeatJoined { seat: plan.seat } });
        events.push(TimedEvent { tick: ante_tick, event: RoundEvent::Anted { seat: plan.seat } });
        first_ante_tick = first_ante_tick.min(ante_tick);
        last_ante_tick = last_ante_tick.max(ante_tick);
        join_tick += ticks_from_ms(random.value_between(JOIN_GAP_MIN_MS, JOIN_GAP_MAX_MS));
    }
    events.sort_by_key(|timed| timed.tick);
    Lobby { events, first_ante_tick, last_ante_tick }
}

fn player_entry(plan: &SeatPlan) -> PlayerEntry {
    let variant_count = PIGEON_NAMES.len();
    let seat = usize::from(plan.seat);
    let base_name = PIGEON_NAMES.get(seat % variant_count).copied().unwrap_or("Gary");
    let repeat = seat / variant_count;
    let name = if repeat == 0 {
        base_name.to_string()
    } else {
        format!("{base_name} {}", repeat + 1)
    };
    PlayerEntry {
        seat: plan.seat,
        name,
        variant: u8::try_from(seat % variant_count).unwrap_or(0),
        temperament: plan.temperament,
    }
}

fn ticks_from_ms(duration_ms: u64) -> u64 {
    duration_ms.div_ceil(TICK_MS)
}

fn rule_failure(step: &'static str, tick: u64, error: RuleError) -> SimulationError {
    SimulationError::Rule { step, tick, error }
}

fn accept_refusal(step: &'static str, tick: u64, error: RuleError) -> Result<(), SimulationError> {
    match error {
        RuleError::MathOverflow | RuleError::ChipsNotConserved => {
            Err(rule_failure(step, tick, error))
        }
        _ => Ok(()),
    }
}

impl LiveTable {
    fn play(mut self) -> Result<Vec<TimedEvent>, SimulationError> {
        let end_tick = self.round.end_tick;
        self.emit(
            self.start_tick,
            RoundEvent::WhaleDrawn {
                whale_seat: self.whale.seat,
                sandwich_box: self.round.sandwich_box,
                end_tick,
            },
        )?;
        let actor_count = self.pigeons.len() + 1;
        let mut first_actor = 0;
        for tick in self.start_tick..=end_tick {
            self.announce_arrivals(tick)?;
            self.land_swat(tick)?;
            if tick == end_tick {
                self.settle(tick)?;
                break;
            }
            for offset in 0..actor_count {
                let actor = (first_actor + offset) % actor_count;
                if actor < self.pigeons.len() {
                    self.act_as_pigeon(actor, tick)?;
                } else {
                    self.act_as_whale(tick)?;
                }
            }
            first_actor = (first_actor + 1) % actor_count;
            let view = TableView::observe(&self.round, &self.pigeons, tick, self.last_crumb_box);
            self.views.push(view);
        }
        Ok(self.events)
    }

    fn emit(&mut self, tick: u64, event: RoundEvent) -> Result<(), SimulationError> {
        self.events.push(TimedEvent { tick, event });
        let expected = self.round.anted_crumbs;
        let found = self.round.crumbs_in_play(&self.pigeons);
        if found != Some(expected) {
            return Err(SimulationError::ChipsNotConserved { tick, expected, found });
        }
        Ok(())
    }

    fn view_seen_by(&self, reaction_ticks: u64, tick: u64) -> Option<TableView> {
        let seen_tick = tick.checked_sub(reaction_ticks)?;
        let offset = seen_tick.checked_sub(self.start_tick)?;
        self.views.get(usize::try_from(offset).ok()?).copied()
    }

    fn announce_arrivals(&mut self, tick: u64) -> Result<(), SimulationError> {
        let arrivals: Vec<RoundEvent> = self
            .pigeon_plans
            .iter()
            .zip(&self.pigeons)
            .filter_map(|(plan, pigeon)| match pigeon.state {
                PigeonState::Flying { box_index, lands_tick } if lands_tick == tick => {
                    Some(RoundEvent::Landed { seat: plan.seat, box_index })
                }
                PigeonState::Stunned { until_tick, .. } if until_tick == tick => {
                    Some(RoundEvent::StunEnded { seat: plan.seat })
                }
                _ => None,
            })
            .collect();
        for arrival in arrivals {
            self.emit(tick, arrival)?;
        }
        Ok(())
    }

    fn land_swat(&mut self, tick: u64) -> Result<(), SimulationError> {
        let Hand::Raised { box_index, lands_tick } = self.round.hand else {
            return Ok(());
        };
        if lands_tick != tick {
            return Ok(());
        }
        let mut hits = Vec::new();
        for (plan, pigeon) in self.pigeon_plans.iter().zip(self.pigeons.iter_mut()) {
            let report = self
                .round
                .apply_pending_swats(pigeon, tick, &self.timing)
                .map_err(|error| rule_failure("apply_pending_swats", tick, error))?;
            if report.hit_count == 0 {
                continue;
            }
            let PigeonState::Stunned { until_tick, .. } = pigeon.state else {
                return Err(SimulationError::UnexpectedPigeonState { seat: plan.seat, tick });
            };
            hits.push(SwatHit { seat: plan.seat, dropped_crumbs: report.dropped_crumbs, until_tick });
        }
        let swat_number = self.round.swat_count;
        self.emit(tick, RoundEvent::SwatLanded { box_index, swat_number, hits })
    }

    fn settle(&mut self, tick: u64) -> Result<(), SimulationError> {
        let settlement = self
            .round
            .settle(&mut self.pigeons, tick, &self.timing)
            .map_err(|error| rule_failure("settle", tick, error))?;
        let beaks = self
            .pigeon_plans
            .iter()
            .zip(&self.pigeons)
            .map(|(plan, pigeon)| SeatCrumbs { seat: plan.seat, crumbs: pigeon.beak_crumbs })
            .collect();
        self.emit(
            tick,
            RoundEvent::Settled {
                whale_crumbs: settlement.whale_crumbs,
                pigeon_crumbs: settlement.pigeon_crumbs,
                beaks,
            },
        )
    }

    fn act_as_whale(&mut self, tick: u64) -> Result<(), SimulationError> {
        let Some(view) = self.view_seen_by(self.whale.reaction_ticks, tick) else {
            return Ok(());
        };
        let would_land_tick = tick.saturating_add(self.timing.swat_windup_ticks);
        if would_land_tick > self.round.end_tick {
            return Ok(());
        }
        let Some(target_box) = choose_swat_box(&view) else {
            return Ok(());
        };
        match self.round.raise_hand(target_box, tick, &self.timing) {
            Ok(swat) => self.emit(
                tick,
                RoundEvent::HandRaised {
                    box_index: swat.box_index,
                    swat_number: swat.number,
                    lands_tick: swat.lands_tick,
                },
            ),
            Err(error) => accept_refusal("raise_hand", tick, error),
        }
    }

    fn act_as_pigeon(&mut self, index: usize, tick: u64) -> Result<(), SimulationError> {
        let (Some(plan), Some(pigeon)) =
            (self.pigeon_plans.get(index).copied(), self.pigeons.get(index).copied())
        else {
            return Ok(());
        };
        let Some(view) = self.view_seen_by(plan.reaction_ticks, tick) else {
            return Ok(());
        };
        let state = pigeon.state.settled_at(tick);
        let situation =
            PigeonSituation { state, can_peck: tick >= pigeon.next_peck_tick, view };
        let mut next_pigeon = pigeon;
        let late_swat = SimulationError::LateSwat { seat: plan.seat, tick };
        let unexpected = SimulationError::UnexpectedPigeonState { seat: plan.seat, tick };
        let event = match choose_pigeon_move(plan.temperament, &situation) {
            PigeonMove::Wait => return Ok(()),
            PigeonMove::FlyTo(target_box) => {
                match self.round.fly_to(&mut next_pigeon, target_box, tick, &self.timing) {
                    Ok(MoveOutcome::Moved) => {
                        let PigeonState::Flying { box_index, lands_tick } = next_pigeon.state
                        else {
                            return Err(unexpected);
                        };
                        RoundEvent::Flew { seat: plan.seat, box_index, lands_tick }
                    }
                    Ok(MoveOutcome::FlattenedBySwat { .. }) => return Err(late_swat),
                    Err(error) => return accept_refusal("fly_to", tick, error),
                }
            }
            PigeonMove::TakeOff => match self.round.take_off(&mut next_pigeon, tick, &self.timing)
            {
                Ok(MoveOutcome::Moved) => RoundEvent::TookOff { seat: plan.seat },
                Ok(MoveOutcome::FlattenedBySwat { .. }) => return Err(late_swat),
                Err(error) => return accept_refusal("take_off", tick, error),
            },
            PigeonMove::Peck => {
                let PigeonState::Perched { box_index } = state else {
                    return Err(unexpected);
                };
                let result = match self.round.peck(&mut next_pigeon, tick, &self.timing) {
                    Ok(PeckOutcome::TookLooseCrumb) => PeckResult::LooseCrumb,
                    Ok(PeckOutcome::TookSandwichCrumb) => PeckResult::SandwichCrumb,
                    Ok(PeckOutcome::StunnedOnEmptyBox) => {
                        let PigeonState::Stunned { until_tick, .. } = next_pigeon.state else {
                            return Err(unexpected);
                        };
                        PeckResult::EmptyBox { until_tick }
                    }
                    Ok(PeckOutcome::FlattenedBySwat { .. }) => return Err(late_swat),
                    Err(error) => return accept_refusal("peck", tick, error),
                };
                if !matches!(result, PeckResult::EmptyBox { .. }) {
                    self.last_crumb_box = Some(box_index);
                }
                RoundEvent::Pecked { seat: plan.seat, box_index, result }
            }
        };
        if let Some(stored) = self.pigeons.get_mut(index) {
            *stored = next_pigeon;
        }
        self.emit(tick, event)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::render_round_file;

    #[test]
    fn the_same_arguments_give_a_byte_identical_file() {
        let config = RoundConfig { players: 8, seed: 7, timing: standard_timing().expect("standard timing") };
        let first = simulate_round(config).map(|round| render_round_file(&round).ok());
        let second = simulate_round(config).map(|round| render_round_file(&round).ok());
        assert!(matches!(first, Ok(Some(_))));
        assert_eq!(first, second);
    }

    #[test]
    fn every_table_size_plays_to_a_conserved_settlement() {
        for players in 2..=21u8 {
            for seed in 0..3u64 {
                let recorded = simulate_round(RoundConfig { players, seed, timing: standard_timing().expect("standard timing") });
                let last_event = recorded.as_ref().ok().and_then(|round| round.events.last());
                let Some(TimedEvent {
                    event: RoundEvent::Settled { whale_crumbs, pigeon_crumbs, .. },
                    ..
                }) = last_event
                else {
                    panic!("players {players} seed {seed} ended without a settlement: {recorded:?}");
                };
                assert_eq!(whale_crumbs + pigeon_crumbs, u64::from(players) * CHIPS_PER_ANTE);
            }
        }
    }
}
