use crate::constants::{
    CHIPS_PER_ANTE, MAX_BOXES, MAX_SEATS, MAX_SWITCHES, MIN_PLAYERS, PERCHES_PER_BOX,
    SWAT_DROP_PERCENT, SWAT_HISTORY_LEN,
};
use crate::error::RuleError;
use crate::pigeon::{Pigeon, PigeonState};
use crate::timing::Timing;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Swat {
    pub number: u64,
    pub box_index: u8,
    pub lands_tick: u64,
}

const NO_SWAT: Swat = Swat { number: 0, box_index: 0, lands_tick: 0 };

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hand {
    Idle { ready_tick: u64 },
    Raised { box_index: u8, lands_tick: u64 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PeckOutcome {
    TookLooseCrumb,
    TookSandwichCrumb,
    StunnedOnEmptyBox,
    FlattenedBySwat { dropped_crumbs: u64 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MoveOutcome {
    Moved,
    FlattenedBySwat { dropped_crumbs: u64 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Settlement {
    pub whale_crumbs: u64,
    pub pigeon_crumbs: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SwatReport {
    pub hit_count: u64,
    pub dropped_crumbs: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Round {
    pub box_count: u8,
    pub sandwich_box: u8,
    pub end_tick: u64,
    pub anted_crumbs: u64,
    pub pot_crumbs: u64,
    pub loose_crumbs: [u64; MAX_BOXES],
    pub perch_claims: [u8; MAX_BOXES],
    pub hand: Hand,
    pub swats: [Swat; SWAT_HISTORY_LEN],
    pub swat_count: u64,
    pub switch_count: u8,
    pub next_switch_tick: u64,
}

impl Round {
    pub fn start(
        box_count: u8,
        sandwich_box: u8,
        anted_players: u8,
        start_tick: u64,
        timing: &Timing,
    ) -> Result<Round, RuleError> {
        if box_count == 0 || usize::from(box_count) > MAX_BOXES {
            return Err(RuleError::BadBoxCount);
        }
        if sandwich_box >= box_count {
            return Err(RuleError::BadBox);
        }
        if anted_players < MIN_PLAYERS {
            return Err(RuleError::TooFewPlayers);
        }
        if usize::from(anted_players) > MAX_SEATS {
            return Err(RuleError::TooManyPlayers);
        }
        let anted_crumbs = u64::from(anted_players)
            .checked_mul(CHIPS_PER_ANTE)
            .ok_or(RuleError::MathOverflow)?;
        let end_tick = start_tick
            .checked_add(timing.round_ticks)
            .ok_or(RuleError::MathOverflow)?;
        Ok(Round {
            box_count,
            sandwich_box,
            end_tick,
            anted_crumbs,
            pot_crumbs: anted_crumbs,
            loose_crumbs: [0; MAX_BOXES],
            perch_claims: [0; MAX_BOXES],
            hand: Hand::Idle { ready_tick: start_tick },
            swats: [NO_SWAT; SWAT_HISTORY_LEN],
            swat_count: 0,
            switch_count: 0,
            next_switch_tick: start_tick,
        })
    }

    pub fn peck(
        &mut self,
        pigeon: &mut Pigeon,
        now_tick: u64,
        timing: &Timing,
    ) -> Result<PeckOutcome, RuleError> {
        self.ensure_live(now_tick)?;
        let mut next_round = *self;
        let mut next_pigeon = *pigeon;
        let report = next_round.apply_landed_swats(&mut next_pigeon, now_tick, timing)?;
        let outcome = if was_just_flattened(&report, &next_pigeon) {
            PeckOutcome::FlattenedBySwat { dropped_crumbs: report.dropped_crumbs }
        } else {
            next_round.peck_perched_box(&mut next_pigeon, now_tick, timing)?
        };
        *self = next_round;
        *pigeon = next_pigeon;
        Ok(outcome)
    }

    pub fn fly_to(
        &mut self,
        pigeon: &mut Pigeon,
        target_box: u8,
        now_tick: u64,
        timing: &Timing,
    ) -> Result<MoveOutcome, RuleError> {
        self.ensure_live(now_tick)?;
        if target_box >= self.box_count {
            return Err(RuleError::BadBox);
        }
        let mut next_round = *self;
        let mut next_pigeon = *pigeon;
        let report = next_round.apply_landed_swats(&mut next_pigeon, now_tick, timing)?;
        let outcome = if was_just_flattened(&report, &next_pigeon) {
            MoveOutcome::FlattenedBySwat { dropped_crumbs: report.dropped_crumbs }
        } else {
            if matches!(next_pigeon.state, PigeonState::Stunned { .. }) {
                return Err(RuleError::Stunned);
            }
            if next_pigeon.state.claimed_box() == Some(target_box) {
                return Err(RuleError::AlreadyThere);
            }
            if next_round.perch_claims[usize::from(target_box)] >= PERCHES_PER_BOX {
                return Err(RuleError::BoxFull);
            }
            next_round.release_claim(&next_pigeon)?;
            next_round.perch_claims[usize::from(target_box)] += 1;
            let lands_tick = now_tick
                .checked_add(timing.flight_ticks)
                .ok_or(RuleError::MathOverflow)?;
            next_pigeon.state = PigeonState::Flying { box_index: target_box, lands_tick };
            MoveOutcome::Moved
        };
        *self = next_round;
        *pigeon = next_pigeon;
        Ok(outcome)
    }

    pub fn take_off(
        &mut self,
        pigeon: &mut Pigeon,
        now_tick: u64,
        timing: &Timing,
    ) -> Result<MoveOutcome, RuleError> {
        self.ensure_live(now_tick)?;
        let mut next_round = *self;
        let mut next_pigeon = *pigeon;
        let report = next_round.apply_landed_swats(&mut next_pigeon, now_tick, timing)?;
        let outcome = if was_just_flattened(&report, &next_pigeon) {
            MoveOutcome::FlattenedBySwat { dropped_crumbs: report.dropped_crumbs }
        } else {
            match next_pigeon.state {
                PigeonState::Stunned { .. } => return Err(RuleError::Stunned),
                PigeonState::Hovering => return Err(RuleError::AlreadyHovering),
                PigeonState::Flying { .. } | PigeonState::Perched { .. } => {}
            }
            next_round.release_claim(&next_pigeon)?;
            next_pigeon.state = PigeonState::Hovering;
            MoveOutcome::Moved
        };
        *self = next_round;
        *pigeon = next_pigeon;
        Ok(outcome)
    }

    pub fn raise_hand(
        &mut self,
        target_box: u8,
        now_tick: u64,
        timing: &Timing,
    ) -> Result<Swat, RuleError> {
        self.ensure_live(now_tick)?;
        if target_box >= self.box_count {
            return Err(RuleError::BadBox);
        }
        let ready_tick = match self.hand {
            Hand::Idle { ready_tick } => ready_tick,
            Hand::Raised { lands_tick, .. } => lands_tick
                .checked_add(timing.swat_cooldown_ticks)
                .ok_or(RuleError::MathOverflow)?,
        };
        if now_tick < ready_tick {
            return Err(RuleError::HandBusy);
        }
        let number = self.swat_count.checked_add(1).ok_or(RuleError::MathOverflow)?;
        let lands_tick = now_tick
            .checked_add(timing.swat_windup_ticks)
            .ok_or(RuleError::MathOverflow)?;
        let swat = Swat { number, box_index: target_box, lands_tick };
        self.swats[history_slot(number)] = swat;
        self.swat_count = number;
        self.hand = Hand::Raised { box_index: target_box, lands_tick };
        Ok(swat)
    }

    pub fn switch_sandwich(
        &mut self,
        target_box: u8,
        now_tick: u64,
        timing: &Timing,
    ) -> Result<(), RuleError> {
        self.ensure_live(now_tick)?;
        if self.box_count == 1 {
            return Err(RuleError::OneBoxCannotSwitch);
        }
        if target_box >= self.box_count {
            return Err(RuleError::BadBox);
        }
        if self.switch_count >= MAX_SWITCHES {
            return Err(RuleError::NoSwitchesLeft);
        }
        if now_tick < self.next_switch_tick {
            return Err(RuleError::SwitchTooSoon);
        }
        let next_switch_tick = now_tick
            .checked_add(timing.switch_cooldown_ticks)
            .ok_or(RuleError::MathOverflow)?;
        self.sandwich_box = target_box;
        self.switch_count += 1;
        self.next_switch_tick = next_switch_tick;
        Ok(())
    }

    pub fn settle(
        &mut self,
        pigeons: &mut [Pigeon],
        now_tick: u64,
        timing: &Timing,
    ) -> Result<Settlement, RuleError> {
        if now_tick < self.end_tick {
            return Err(RuleError::RoundNotOver);
        }
        self.apply_landed_swats_to_all(pigeons, self.end_tick, timing)?;
        let mut pigeon_crumbs: u64 = 0;
        for pigeon in pigeons.iter() {
            pigeon_crumbs = pigeon_crumbs
                .checked_add(pigeon.beak_crumbs)
                .ok_or(RuleError::MathOverflow)?;
        }
        let mut whale_crumbs = self.pot_crumbs;
        for loose in self.loose_crumbs {
            whale_crumbs = whale_crumbs.checked_add(loose).ok_or(RuleError::MathOverflow)?;
        }
        let total = whale_crumbs
            .checked_add(pigeon_crumbs)
            .ok_or(RuleError::MathOverflow)?;
        if total != self.anted_crumbs {
            return Err(RuleError::ChipsNotConserved);
        }
        Ok(Settlement { whale_crumbs, pigeon_crumbs })
    }

    pub fn apply_pending_swats(
        &mut self,
        pigeon: &mut Pigeon,
        now_tick: u64,
        timing: &Timing,
    ) -> Result<SwatReport, RuleError> {
        let mut next_round = *self;
        let mut next_pigeon = *pigeon;
        let report = next_round.apply_landed_swats(&mut next_pigeon, now_tick, timing)?;
        *self = next_round;
        *pigeon = next_pigeon;
        Ok(report)
    }

    pub fn land_swat(
        &mut self,
        pigeons: &mut [Pigeon],
        now_tick: u64,
        timing: &Timing,
    ) -> Result<SwatReport, RuleError> {
        self.ensure_live(now_tick)?;
        let mut next_round = *self;
        let mut next_pigeons = pigeons.to_vec();
        let report = next_round.apply_landed_swats_to_all(&mut next_pigeons, now_tick, timing)?;
        *self = next_round;
        pigeons.copy_from_slice(&next_pigeons);
        Ok(report)
    }

    pub fn crumbs_in_play(&self, pigeons: &[Pigeon]) -> Option<u64> {
        let mut total = self.pot_crumbs;
        for loose in self.loose_crumbs {
            total = total.checked_add(loose)?;
        }
        for pigeon in pigeons {
            total = total.checked_add(pigeon.beak_crumbs)?;
        }
        Some(total)
    }

    fn ensure_live(&self, now_tick: u64) -> Result<(), RuleError> {
        if now_tick >= self.end_tick {
            return Err(RuleError::RoundOver);
        }
        Ok(())
    }

    fn release_claim(&mut self, pigeon: &Pigeon) -> Result<(), RuleError> {
        if let Some(claimed_box) = pigeon.state.claimed_box() {
            let claims = &mut self.perch_claims[usize::from(claimed_box)];
            *claims = claims.checked_sub(1).ok_or(RuleError::MathOverflow)?;
        }
        Ok(())
    }

    fn peck_perched_box(
        &mut self,
        pigeon: &mut Pigeon,
        now_tick: u64,
        timing: &Timing,
    ) -> Result<PeckOutcome, RuleError> {
        let perched_box = match pigeon.state {
            PigeonState::Stunned { .. } => return Err(RuleError::Stunned),
            PigeonState::Hovering | PigeonState::Flying { .. } => {
                return Err(RuleError::NotPerched)
            }
            PigeonState::Perched { box_index } => box_index,
        };
        if now_tick < pigeon.next_peck_tick {
            return Err(RuleError::PeckTooSoon);
        }
        pigeon.next_peck_tick = now_tick
            .checked_add(timing.peck_cooldown_ticks)
            .ok_or(RuleError::MathOverflow)?;
        let loose = &mut self.loose_crumbs[usize::from(perched_box)];
        if *loose > 0 {
            *loose -= 1;
            pigeon.beak_crumbs = pigeon.beak_crumbs.checked_add(1).ok_or(RuleError::MathOverflow)?;
            return Ok(PeckOutcome::TookLooseCrumb);
        }
        if perched_box == self.sandwich_box && self.pot_crumbs > 0 {
            self.pot_crumbs -= 1;
            pigeon.beak_crumbs = pigeon.beak_crumbs.checked_add(1).ok_or(RuleError::MathOverflow)?;
            return Ok(PeckOutcome::TookSandwichCrumb);
        }
        let until_tick = now_tick
            .checked_add(timing.empty_box_stun_ticks)
            .ok_or(RuleError::MathOverflow)?;
        pigeon.state = PigeonState::Stunned { box_index: perched_box, until_tick };
        Ok(PeckOutcome::StunnedOnEmptyBox)
    }

    fn apply_landed_swats(
        &mut self,
        pigeon: &mut Pigeon,
        now_tick: u64,
        timing: &Timing,
    ) -> Result<SwatReport, RuleError> {
        let mut report = SwatReport { hit_count: 0, dropped_crumbs: 0 };
        let oldest_kept = self.swat_count.saturating_sub(SWAT_HISTORY_LEN as u64 - 1).max(1);
        let mut number = pigeon.last_swat_number.saturating_add(1).max(oldest_kept);
        while number <= self.swat_count {
            let swat = self.swats[history_slot(number)];
            if swat.number != number || swat.lands_tick > now_tick {
                break;
            }
            if pigeon.state.stands_on(swat.box_index, swat.lands_tick) {
                let dropped = pigeon
                    .beak_crumbs
                    .checked_mul(SWAT_DROP_PERCENT)
                    .ok_or(RuleError::MathOverflow)?
                    .div_ceil(100);
                let loose = &mut self.loose_crumbs[usize::from(swat.box_index)];
                *loose = loose.checked_add(dropped).ok_or(RuleError::MathOverflow)?;
                pigeon.beak_crumbs -= dropped;
                let until_tick = swat
                    .lands_tick
                    .checked_add(timing.swat_stun_ticks)
                    .ok_or(RuleError::MathOverflow)?;
                pigeon.state = PigeonState::Stunned { box_index: swat.box_index, until_tick };
                report.hit_count += 1;
                report.dropped_crumbs += dropped;
            }
            pigeon.last_swat_number = number;
            number += 1;
        }
        pigeon.state = pigeon.state.settled_at(now_tick);
        Ok(report)
    }

    fn apply_landed_swats_to_all(
        &mut self,
        pigeons: &mut [Pigeon],
        now_tick: u64,
        timing: &Timing,
    ) -> Result<SwatReport, RuleError> {
        let mut total = SwatReport { hit_count: 0, dropped_crumbs: 0 };
        for pigeon in pigeons.iter_mut() {
            let report = self.apply_landed_swats(pigeon, now_tick, timing)?;
            total.hit_count = total
                .hit_count
                .checked_add(report.hit_count)
                .ok_or(RuleError::MathOverflow)?;
            total.dropped_crumbs = total
                .dropped_crumbs
                .checked_add(report.dropped_crumbs)
                .ok_or(RuleError::MathOverflow)?;
        }
        Ok(total)
    }
}

fn history_slot(swat_number: u64) -> usize {
    ((swat_number.saturating_sub(1)) % SWAT_HISTORY_LEN as u64) as usize
}

fn was_just_flattened(report: &SwatReport, pigeon: &Pigeon) -> bool {
    report.hit_count > 0 && matches!(pigeon.state, PigeonState::Stunned { .. })
}
