use proptest::prelude::*;
use sandwich_rules::constants::{CHIPS_PER_ANTE, MAX_BOXES, PERCHES_PER_BOX};
use sandwich_rules::{PeckOutcome, Pigeon, Round, RuleError, Timing};

const TICK_MS: u64 = 10;
const MAX_TICK_STEP: u64 = 120;
const MAX_ACTIONS: usize = 400;

#[derive(Clone, Debug)]
enum Action {
    Peck { pigeon: usize },
    FlyTo { pigeon: usize, box_index: u8 },
    TakeOff { pigeon: usize },
    RaiseHand { box_index: u8 },
    Switch { box_index: u8 },
}

fn action_strategy() -> impl Strategy<Value = Action> {
    prop_oneof![
        5 => (0usize..20).prop_map(|pigeon| Action::Peck { pigeon }),
        2 => (0usize..20, 0u8..4).prop_map(|(pigeon, box_index)| Action::FlyTo { pigeon, box_index }),
        1 => (0usize..20).prop_map(|pigeon| Action::TakeOff { pigeon }),
        2 => (0u8..4).prop_map(|box_index| Action::RaiseHand { box_index }),
        1 => (0u8..4).prop_map(|box_index| Action::Switch { box_index }),
    ]
}

fn claims_per_box(pigeons: &[Pigeon]) -> [u8; MAX_BOXES] {
    let mut claims = [0u8; MAX_BOXES];
    for pigeon in pigeons {
        if let Some(claimed_box) = pigeon.state.claimed_box() {
            claims[usize::from(claimed_box)] += 1;
        }
    }
    claims
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2_000))]

    #[test]
    fn chips_are_conserved_and_limits_hold_under_any_order_of_actions(
        box_count in 1u8..=3,
        sandwich_seed in 0u8..3,
        pigeon_count in 1usize..=20,
        steps in prop::collection::vec((action_strategy(), 0u64..MAX_TICK_STEP), 1..MAX_ACTIONS),
    ) {
        let timing = Timing::from_tick_ms(TICK_MS).expect("a positive tick length");
        let anted_players = (pigeon_count + 1) as u8;
        let mut round = Round::start(box_count, sandwich_seed % box_count, anted_players, 0, &timing)
            .expect("a valid round");
        let anted_crumbs = u64::from(anted_players) * CHIPS_PER_ANTE;
        let mut pigeons = vec![Pigeon::at_round_start(); pigeon_count];
        let mut last_peck_tick: Vec<Option<u64>> = vec![None; pigeon_count];
        let mut now_tick = 0u64;

        for (action, tick_step) in steps {
            now_tick += tick_step;
            let pot_before = round.pot_crumbs;
            let round_before = round;
            let pigeons_before = pigeons.clone();
            let refused = match action {
                Action::Peck { pigeon } => {
                    let index = pigeon % pigeon_count;
                    let outcome = round.peck(&mut pigeons[index], now_tick, &timing);
                    if matches!(
                        outcome,
                        Ok(PeckOutcome::TookLooseCrumb | PeckOutcome::TookSandwichCrumb | PeckOutcome::StunnedOnEmptyBox)
                    ) {
                        if let Some(previous_tick) = last_peck_tick[index] {
                            prop_assert!(now_tick - previous_tick >= timing.peck_cooldown_ticks);
                        }
                        last_peck_tick[index] = Some(now_tick);
                    }
                    outcome.err()
                }
                Action::FlyTo { pigeon, box_index } => {
                    let index = pigeon % pigeon_count;
                    round.fly_to(&mut pigeons[index], box_index, now_tick, &timing).err()
                }
                Action::TakeOff { pigeon } => {
                    let index = pigeon % pigeon_count;
                    round.take_off(&mut pigeons[index], now_tick, &timing).err()
                }
                Action::RaiseHand { box_index } => round.raise_hand(box_index, now_tick, &timing).err(),
                Action::Switch { box_index } => round.switch_sandwich(box_index, now_tick, &timing).err(),
            };

            if refused.is_some() {
                prop_assert_eq!(round, round_before);
                prop_assert_eq!(&pigeons, &pigeons_before);
            }
            prop_assert_ne!(refused, Some(RuleError::MathOverflow));
            prop_assert_ne!(refused, Some(RuleError::ChipsNotConserved));
            prop_assert_eq!(round.crumbs_in_play(&pigeons), Some(anted_crumbs));
            prop_assert!(round.pot_crumbs <= pot_before);
            prop_assert!(round.sandwich_box < box_count);
            prop_assert_eq!(round.perch_claims, claims_per_box(&pigeons));
            for claims in round.perch_claims {
                prop_assert!(claims <= PERCHES_PER_BOX);
            }
        }

        let settle_tick = round.end_tick.max(now_tick);
        let settlement = round.settle(&mut pigeons, settle_tick, &timing);
        prop_assert!(settlement.is_ok());
        let settlement = settlement.expect("checked above");
        prop_assert_eq!(settlement.whale_crumbs + settlement.pigeon_crumbs, anted_crumbs);
    }
}
