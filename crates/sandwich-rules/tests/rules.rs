use sandwich_rules::constants::{CHIPS_PER_ANTE, MAX_SWITCHES, PERCHES_PER_BOX};
use sandwich_rules::{
    can_start_round, pick_default_box, pick_whale, MoveOutcome, PeckOutcome, Pigeon, PigeonState,
    Round, RuleError, SwatReport, Timing,
};

const TICK_MS: u64 = 10;
const SANDWICH_BOX: u8 = 1;
const EMPTY_BOX: u8 = 0;
const THREE_BOXES: u8 = 3;
const EIGHT_PLAYERS: u8 = 8;

fn timing() -> Timing {
    Timing::from_tick_ms(TICK_MS).expect("a positive tick length")
}

fn started_round() -> Round {
    Round::start(THREE_BOXES, SANDWICH_BOX, EIGHT_PLAYERS, 0, &timing()).expect("a valid round")
}

fn perched_pigeon(round: &mut Round, box_index: u8, now_tick: u64) -> (Pigeon, u64) {
    let mut pigeon = Pigeon::at_round_start();
    let outcome = round.fly_to(&mut pigeon, box_index, now_tick, &timing());
    assert_eq!(outcome, Ok(MoveOutcome::Moved));
    (pigeon, now_tick + timing().flight_ticks)
}

#[test]
fn pot_starts_with_every_ante() {
    let round = started_round();
    assert_eq!(round.pot_crumbs, u64::from(EIGHT_PLAYERS) * CHIPS_PER_ANTE);
    assert_eq!(round.end_tick, timing().round_ticks);
}

#[test]
fn peck_on_the_sandwich_box_takes_one_crumb_from_the_pot() {
    let mut round = started_round();
    let pot_before = round.pot_crumbs;
    let (mut pigeon, landed_tick) = perched_pigeon(&mut round, SANDWICH_BOX, 0);
    let outcome = round.peck(&mut pigeon, landed_tick, &timing());
    assert_eq!(outcome, Ok(PeckOutcome::TookSandwichCrumb));
    assert_eq!(pigeon.beak_crumbs, 1);
    assert_eq!(round.pot_crumbs, pot_before - 1);
}

#[test]
fn peck_on_an_empty_box_stuns_the_pigeon() {
    let mut round = started_round();
    let (mut pigeon, landed_tick) = perched_pigeon(&mut round, EMPTY_BOX, 0);
    let outcome = round.peck(&mut pigeon, landed_tick, &timing());
    assert_eq!(outcome, Ok(PeckOutcome::StunnedOnEmptyBox));
    let stunned_until = landed_tick + timing().empty_box_stun_ticks;
    assert_eq!(
        round.peck(&mut pigeon, stunned_until - 1, &timing()),
        Err(RuleError::Stunned)
    );
    assert_eq!(
        round.fly_to(&mut pigeon, SANDWICH_BOX, stunned_until - 1, &timing()),
        Err(RuleError::Stunned)
    );
    assert_eq!(
        round.fly_to(&mut pigeon, SANDWICH_BOX, stunned_until, &timing()),
        Ok(MoveOutcome::Moved)
    );
}

#[test]
fn a_pigeon_cannot_peck_before_it_lands() {
    let mut round = started_round();
    let (mut pigeon, landed_tick) = perched_pigeon(&mut round, SANDWICH_BOX, 0);
    assert_eq!(
        round.peck(&mut pigeon, landed_tick - 1, &timing()),
        Err(RuleError::NotPerched)
    );
}

#[test]
fn two_pecks_need_the_cooldown_between_them() {
    let mut round = started_round();
    let (mut pigeon, landed_tick) = perched_pigeon(&mut round, SANDWICH_BOX, 0);
    assert_eq!(
        round.peck(&mut pigeon, landed_tick, &timing()),
        Ok(PeckOutcome::TookSandwichCrumb)
    );
    let pigeon_before = pigeon;
    let round_before = round;
    let too_soon_tick = landed_tick + timing().peck_cooldown_ticks - 1;
    assert_eq!(
        round.peck(&mut pigeon, too_soon_tick, &timing()),
        Err(RuleError::PeckTooSoon)
    );
    assert_eq!(pigeon, pigeon_before);
    assert_eq!(round, round_before);
    assert_eq!(
        round.peck(&mut pigeon, too_soon_tick + 1, &timing()),
        Ok(PeckOutcome::TookSandwichCrumb)
    );
}

#[test]
fn a_swat_flattens_perched_pigeons_and_drops_half_their_beak_rounded_up() {
    let mut round = started_round();
    let (mut pigeon, landed_tick) = perched_pigeon(&mut round, SANDWICH_BOX, 0);
    let mut now_tick = landed_tick;
    for _ in 0..5 {
        assert_eq!(
            round.peck(&mut pigeon, now_tick, &timing()),
            Ok(PeckOutcome::TookSandwichCrumb)
        );
        now_tick += timing().peck_cooldown_ticks;
    }
    let swat = round.raise_hand(SANDWICH_BOX, now_tick, &timing()).expect("a free hand");
    let outcome = round.peck(&mut pigeon, swat.lands_tick, &timing());
    assert_eq!(outcome, Ok(PeckOutcome::FlattenedBySwat { dropped_crumbs: 3 }));
    assert_eq!(pigeon.beak_crumbs, 2);
    assert_eq!(round.loose_crumbs[usize::from(SANDWICH_BOX)], 3);
    assert_eq!(
        pigeon.state,
        PigeonState::Stunned {
            box_index: SANDWICH_BOX,
            until_tick: swat.lands_tick + timing().swat_stun_ticks
        }
    );
}

#[test]
fn a_pigeon_that_takes_off_before_the_hand_lands_is_not_hit() {
    let mut round = started_round();
    let (mut pigeon, landed_tick) = perched_pigeon(&mut round, SANDWICH_BOX, 0);
    assert_eq!(
        round.peck(&mut pigeon, landed_tick, &timing()),
        Ok(PeckOutcome::TookSandwichCrumb)
    );
    let swat = round.raise_hand(SANDWICH_BOX, landed_tick + 1, &timing()).expect("a free hand");
    assert_eq!(
        round.take_off(&mut pigeon, swat.lands_tick - 1, &timing()),
        Ok(MoveOutcome::Moved)
    );
    assert_eq!(
        round.fly_to(&mut pigeon, SANDWICH_BOX, swat.lands_tick + 1, &timing()),
        Ok(MoveOutcome::Moved)
    );
    assert_eq!(pigeon.beak_crumbs, 1);
    assert_eq!(round.loose_crumbs, [0, 0, 0]);
}

#[test]
fn loose_crumbs_are_taken_first_even_on_a_box_without_the_sandwich() {
    let mut round = started_round();
    let (mut rich_pigeon, landed_tick) = perched_pigeon(&mut round, SANDWICH_BOX, 0);
    let mut now_tick = landed_tick;
    for _ in 0..4 {
        round.peck(&mut rich_pigeon, now_tick, &timing()).expect("a crumb");
        now_tick += timing().peck_cooldown_ticks;
    }
    assert_eq!(
        round.fly_to(&mut rich_pigeon, EMPTY_BOX, now_tick, &timing()),
        Ok(MoveOutcome::Moved)
    );
    let (mut poor_pigeon, _) = perched_pigeon(&mut round, EMPTY_BOX, now_tick);
    let both_landed_tick = now_tick + timing().flight_ticks;
    let swat = round.raise_hand(EMPTY_BOX, both_landed_tick, &timing()).expect("a free hand");
    assert_eq!(
        round.take_off(&mut poor_pigeon, swat.lands_tick - 1, &timing()),
        Ok(MoveOutcome::Moved)
    );
    assert_eq!(
        round.peck(&mut rich_pigeon, swat.lands_tick, &timing()),
        Ok(PeckOutcome::FlattenedBySwat { dropped_crumbs: 2 })
    );
    assert_eq!(
        round.fly_to(&mut poor_pigeon, EMPTY_BOX, swat.lands_tick, &timing()),
        Ok(MoveOutcome::Moved)
    );
    let poor_landed_tick = swat.lands_tick + timing().flight_ticks;
    assert_eq!(
        round.peck(&mut poor_pigeon, poor_landed_tick, &timing()),
        Ok(PeckOutcome::TookLooseCrumb)
    );
    assert_eq!(round.loose_crumbs[usize::from(EMPTY_BOX)], 1);
}

#[test]
fn the_hand_is_busy_during_the_wind_up_and_the_cooldown() {
    let mut round = started_round();
    let swat = round.raise_hand(EMPTY_BOX, 0, &timing()).expect("a free hand");
    assert_eq!(
        round.raise_hand(SANDWICH_BOX, swat.lands_tick, &timing()),
        Err(RuleError::HandBusy)
    );
    let ready_tick = swat.lands_tick + timing().swat_cooldown_ticks;
    assert_eq!(
        round.raise_hand(SANDWICH_BOX, ready_tick - 1, &timing()),
        Err(RuleError::HandBusy)
    );
    assert!(round.raise_hand(SANDWICH_BOX, ready_tick, &timing()).is_ok());
}

#[test]
fn a_box_holds_at_most_its_perches() {
    let mut round = started_round();
    for _ in 0..PERCHES_PER_BOX {
        perched_pigeon(&mut round, SANDWICH_BOX, 0);
    }
    let mut late_pigeon = Pigeon::at_round_start();
    assert_eq!(
        round.fly_to(&mut late_pigeon, SANDWICH_BOX, 0, &timing()),
        Err(RuleError::BoxFull)
    );
    assert_eq!(round.perch_claims[usize::from(SANDWICH_BOX)], PERCHES_PER_BOX);
}

#[test]
fn the_whale_can_switch_a_limited_number_of_times_with_a_cooldown() {
    let mut round = started_round();
    assert_eq!(round.switch_sandwich(EMPTY_BOX, 0, &timing()), Ok(()));
    assert_eq!(round.sandwich_box, EMPTY_BOX);
    assert_eq!(
        round.switch_sandwich(SANDWICH_BOX, timing().switch_cooldown_ticks - 1, &timing()),
        Err(RuleError::SwitchTooSoon)
    );
    let mut now_tick = 0;
    for _ in 1..MAX_SWITCHES {
        now_tick += timing().switch_cooldown_ticks;
        assert_eq!(round.switch_sandwich(SANDWICH_BOX, now_tick, &timing()), Ok(()));
    }
    now_tick += timing().switch_cooldown_ticks;
    assert_eq!(
        round.switch_sandwich(EMPTY_BOX, now_tick, &timing()),
        Err(RuleError::NoSwitchesLeft)
    );
}

#[test]
fn after_a_switch_the_old_box_stuns() {
    let mut round = started_round();
    let (mut pigeon, landed_tick) = perched_pigeon(&mut round, SANDWICH_BOX, 0);
    assert_eq!(round.switch_sandwich(EMPTY_BOX, landed_tick, &timing()), Ok(()));
    assert_eq!(
        round.peck(&mut pigeon, landed_tick, &timing()),
        Ok(PeckOutcome::StunnedOnEmptyBox)
    );
}

#[test]
fn a_one_box_round_cannot_switch() {
    let mut round = Round::start(1, 0, EIGHT_PLAYERS, 0, &timing()).expect("a valid round");
    assert_eq!(
        round.switch_sandwich(0, 0, &timing()),
        Err(RuleError::OneBoxCannotSwitch)
    );
}

#[test]
fn nothing_happens_after_the_round_ends_except_settlement() {
    let mut round = started_round();
    let (mut pigeon, _) = perched_pigeon(&mut round, SANDWICH_BOX, 0);
    let end_tick = round.end_tick;
    assert_eq!(round.peck(&mut pigeon, end_tick, &timing()), Err(RuleError::RoundOver));
    assert_eq!(round.raise_hand(EMPTY_BOX, end_tick, &timing()), Err(RuleError::RoundOver));
    assert_eq!(
        round.settle(&mut [pigeon], end_tick - 1, &timing()),
        Err(RuleError::RoundNotOver)
    );
}

#[test]
fn settlement_gives_the_whale_the_pot_and_every_loose_crumb() {
    let mut round = started_round();
    let (mut pigeon, landed_tick) = perched_pigeon(&mut round, SANDWICH_BOX, 0);
    let mut now_tick = landed_tick;
    for _ in 0..10 {
        round.peck(&mut pigeon, now_tick, &timing()).expect("a crumb");
        now_tick += timing().peck_cooldown_ticks;
    }
    let end_tick = round.end_tick;
    let mut pigeons = [pigeon];
    let settlement = round.settle(&mut pigeons, end_tick, &timing()).expect("a settled round");
    assert_eq!(settlement.pigeon_crumbs, 10);
    assert_eq!(settlement.whale_crumbs, u64::from(EIGHT_PLAYERS) * CHIPS_PER_ANTE - 10);
}

#[test]
fn a_pigeon_that_goes_silent_after_a_swat_still_drops_half_at_settlement() {
    let mut round = started_round();
    let (mut pigeon, landed_tick) = perched_pigeon(&mut round, SANDWICH_BOX, 0);
    let mut now_tick = landed_tick;
    for _ in 0..6 {
        round.peck(&mut pigeon, now_tick, &timing()).expect("a crumb");
        now_tick += timing().peck_cooldown_ticks;
    }
    round.raise_hand(SANDWICH_BOX, now_tick, &timing()).expect("a free hand");
    let end_tick = round.end_tick;
    let mut pigeons = [pigeon];
    let settlement = round.settle(&mut pigeons, end_tick, &timing()).expect("a settled round");
    assert_eq!(pigeons[0].beak_crumbs, 3);
    assert_eq!(settlement.pigeon_crumbs, 3);
    assert_eq!(settlement.whale_crumbs, u64::from(EIGHT_PLAYERS) * CHIPS_PER_ANTE - 3);
}

#[test]
fn a_round_needs_two_players_and_a_closed_lobby() {
    assert_eq!(can_start_round(1, 1, 0, 10_000, &timing()), Err(RuleError::TooFewPlayers));
    assert_eq!(
        can_start_round(2, 5, 0, timing().lobby_ticks - 1, &timing()),
        Err(RuleError::LobbyStillOpen)
    );
    assert_eq!(can_start_round(2, 5, 0, timing().lobby_ticks, &timing()), Ok(()));
    assert_eq!(can_start_round(5, 5, 0, 1, &timing()), Ok(()));
}

#[test]
fn the_draw_stays_in_range_for_every_byte_pattern() {
    for fill in [0u8, 1, 127, 200, 255] {
        let randomness = [fill; 32];
        for players in 2..=21u8 {
            assert!(pick_whale(&randomness, players).expect("a whale") < players);
        }
        for boxes in 1..=3u8 {
            assert!(pick_default_box(&randomness, boxes).expect("a box") < boxes);
        }
    }
    assert_eq!(pick_whale(&[0; 32], 1), Err(RuleError::TooFewPlayers));
    assert_eq!(pick_default_box(&[0; 32], 4), Err(RuleError::BadBoxCount));
}

#[test]
fn a_zero_tick_length_is_refused() {
    assert_eq!(Timing::from_tick_ms(0), Err(RuleError::ZeroTickLength));
}

#[test]
fn pending_swats_apply_at_their_landing_tick_once_and_only_to_pigeons_standing_there() {
    let mut round = started_round();
    let (mut perched, landed_tick) = perched_pigeon(&mut round, SANDWICH_BOX, 0);
    let mut hovering = Pigeon::at_round_start();
    let mut now_tick = landed_tick;
    for _ in 0..5 {
        round.peck(&mut perched, now_tick, &timing()).expect("a crumb");
        now_tick += timing().peck_cooldown_ticks;
    }
    let swat = round.raise_hand(SANDWICH_BOX, now_tick, &timing()).expect("a free hand");
    let no_hit = SwatReport { hit_count: 0, dropped_crumbs: 0 };
    assert_eq!(
        round.apply_pending_swats(&mut perched, swat.lands_tick - 1, &timing()),
        Ok(no_hit)
    );
    assert_eq!(
        round.apply_pending_swats(&mut perched, swat.lands_tick, &timing()),
        Ok(SwatReport { hit_count: 1, dropped_crumbs: 3 })
    );
    assert_eq!(
        round.apply_pending_swats(&mut hovering, swat.lands_tick, &timing()),
        Ok(no_hit)
    );
    assert_eq!(
        round.apply_pending_swats(&mut perched, swat.lands_tick + 1, &timing()),
        Ok(no_hit)
    );
    assert_eq!(perched.beak_crumbs, 2);
    assert_eq!(round.loose_crumbs[usize::from(SANDWICH_BOX)], 3);
    assert_eq!(
        perched.state,
        PigeonState::Stunned {
            box_index: SANDWICH_BOX,
            until_tick: swat.lands_tick + timing().swat_stun_ticks
        }
    );
}

#[test]
fn landing_a_swat_drops_every_hit_beak_on_the_box_once_so_the_next_peck_finds_loose_crumbs() {
    let mut round = started_round();
    let mut pigeons = [Pigeon::at_round_start(); 4];
    let beak_targets = [4u64, 3, 1];
    for pigeon in pigeons.iter_mut().take(beak_targets.len()) {
        assert_eq!(round.fly_to(pigeon, SANDWICH_BOX, 0, &timing()), Ok(MoveOutcome::Moved));
    }
    let mut now_tick = timing().flight_ticks;
    for peck_number in 0..4u64 {
        for (pigeon, beak_target) in pigeons.iter_mut().zip(beak_targets) {
            if peck_number < beak_target {
                round.peck(pigeon, now_tick, &timing()).expect("a crumb");
            }
        }
        now_tick += timing().peck_cooldown_ticks;
    }
    for pigeon in pigeons.iter_mut().take(beak_targets.len()) {
        assert_eq!(round.fly_to(pigeon, EMPTY_BOX, now_tick, &timing()), Ok(MoveOutcome::Moved));
    }
    let swat = round
        .raise_hand(EMPTY_BOX, now_tick + timing().flight_ticks, &timing())
        .expect("a free hand");
    let (lazy_round, lazy_pigeons) = (round, pigeons);

    let no_hit = SwatReport { hit_count: 0, dropped_crumbs: 0 };
    assert_eq!(round.land_swat(&mut pigeons, swat.lands_tick - 1, &timing()), Ok(no_hit));
    assert_eq!(round.loose_crumbs, [0, 0, 0]);
    assert_eq!(
        round.land_swat(&mut pigeons, swat.lands_tick, &timing()),
        Ok(SwatReport { hit_count: 3, dropped_crumbs: 5 })
    );
    assert_eq!(round.loose_crumbs[usize::from(EMPTY_BOX)], 5);
    assert_eq!(pigeons.map(|pigeon| pigeon.beak_crumbs), [2, 1, 0, 0]);
    let stunned = PigeonState::Stunned {
        box_index: EMPTY_BOX,
        until_tick: swat.lands_tick + timing().swat_stun_ticks,
    };
    for pigeon in pigeons.iter().take(beak_targets.len()) {
        assert_eq!(pigeon.state, stunned);
        assert_eq!(pigeon.last_swat_number, swat.number);
    }
    assert_eq!(round.crumbs_in_play(&pigeons), Some(u64::from(EIGHT_PLAYERS) * CHIPS_PER_ANTE));

    let (landed_round, landed_pigeons) = (round, pigeons);
    for later_tick in [swat.lands_tick, swat.lands_tick + 1] {
        assert_eq!(round.land_swat(&mut pigeons, later_tick, &timing()), Ok(no_hit));
        assert_eq!((round, pigeons), (landed_round, landed_pigeons));
    }

    let latecomer_landed_tick = swat.lands_tick + timing().flight_ticks;
    let [.., latecomer] = &mut pigeons;
    round.fly_to(latecomer, EMPTY_BOX, swat.lands_tick, &timing()).expect("a free perch");
    assert_eq!(
        round.peck(latecomer, latecomer_landed_tick, &timing()),
        Ok(PeckOutcome::TookLooseCrumb)
    );
    assert_eq!(round.loose_crumbs[usize::from(EMPTY_BOX)], 4);

    let (mut lazy_round, [.., mut lazy_latecomer]) = (lazy_round, lazy_pigeons);
    lazy_round
        .fly_to(&mut lazy_latecomer, EMPTY_BOX, swat.lands_tick, &timing())
        .expect("a free perch");
    assert_eq!(
        lazy_round.peck(&mut lazy_latecomer, latecomer_landed_tick, &timing()),
        Ok(PeckOutcome::StunnedOnEmptyBox)
    );
}

#[test]
fn landing_a_swat_after_the_round_ends_is_refused_and_changes_nothing() {
    let mut round = started_round();
    let (pigeon, _) = perched_pigeon(&mut round, SANDWICH_BOX, 0);
    let mut pigeons = [pigeon];
    let (round_before, pigeons_before) = (round, pigeons);
    let end_tick = round.end_tick;
    assert_eq!(round.land_swat(&mut pigeons, end_tick, &timing()), Err(RuleError::RoundOver));
    assert_eq!((round, pigeons), (round_before, pigeons_before));
}
