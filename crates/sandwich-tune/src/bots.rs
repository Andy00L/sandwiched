use sandwich_rules::constants::{MAX_BOXES, PERCHES_PER_BOX};
use sandwich_rules::{Hand, Pigeon, PigeonState, Round};
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Temperament {
    Greedy,
    Nervous,
    Vulture,
}

pub const TEMPERAMENTS: [Temperament; 3] =
    [Temperament::Greedy, Temperament::Nervous, Temperament::Vulture];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RaisedHand {
    pub box_index: u8,
    pub lands_tick: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TableView {
    pub box_count: u8,
    pub sandwich_box: u8,
    pub pot_crumbs: u64,
    pub standing_pigeons: [u8; MAX_BOXES],
    pub perch_claims: [u8; MAX_BOXES],
    pub loose_crumbs: [u64; MAX_BOXES],
    pub raised_hand: Option<RaisedHand>,
    pub last_crumb_box: Option<u8>,
}

impl TableView {
    pub fn observe(
        round: &Round,
        pigeons: &[Pigeon],
        now_tick: u64,
        last_crumb_box: Option<u8>,
    ) -> TableView {
        let mut standing_pigeons = [0u8; MAX_BOXES];
        for (box_index, standing) in (0u8..).zip(standing_pigeons.iter_mut()) {
            let count = pigeons
                .iter()
                .filter(|pigeon| pigeon.state.stands_on(box_index, now_tick))
                .count();
            *standing = u8::try_from(count).unwrap_or(u8::MAX);
        }
        let raised_hand = match round.hand {
            Hand::Raised { box_index, lands_tick } if lands_tick > now_tick => {
                Some(RaisedHand { box_index, lands_tick })
            }
            Hand::Raised { .. } | Hand::Idle { .. } => None,
        };
        TableView {
            box_count: round.box_count,
            sandwich_box: round.sandwich_box,
            pot_crumbs: round.pot_crumbs,
            standing_pigeons,
            perch_claims: round.perch_claims,
            loose_crumbs: round.loose_crumbs,
            raised_hand,
            last_crumb_box,
        }
    }

    fn loose_on(&self, box_index: u8) -> u64 {
        self.loose_crumbs.get(usize::from(box_index)).copied().unwrap_or(0)
    }

    fn has_room_on(&self, box_index: u8) -> bool {
        self.perch_claims
            .get(usize::from(box_index))
            .is_some_and(|claims| *claims < PERCHES_PER_BOX)
    }

    fn has_food_on(&self, box_index: u8) -> bool {
        self.loose_on(box_index) > 0 || (box_index == self.sandwich_box && self.pot_crumbs > 0)
    }

    fn is_hand_over(&self, box_index: u8) -> bool {
        self.raised_hand.is_some_and(|hand| hand.box_index == box_index)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PigeonMove {
    Wait,
    FlyTo(u8),
    TakeOff,
    Peck,
}

#[derive(Clone, Copy, Debug)]
pub struct PigeonSituation {
    pub state: PigeonState,
    pub can_peck: bool,
    pub view: TableView,
}

pub fn choose_pigeon_move(temperament: Temperament, situation: &PigeonSituation) -> PigeonMove {
    match temperament {
        Temperament::Greedy => choose_greedy_move(situation),
        Temperament::Nervous => choose_nervous_move(situation),
        Temperament::Vulture => choose_vulture_move(situation),
    }
}

pub fn choose_swat_box(view: &TableView) -> Option<u8> {
    (0..view.box_count)
        .filter_map(|box_index| {
            let standing = *view.standing_pigeons.get(usize::from(box_index))?;
            (standing > 0).then_some((standing, box_index == view.sandwich_box, box_index))
        })
        .max_by_key(|(standing, is_sandwich_box, box_index)| {
            (*standing, *is_sandwich_box, core::cmp::Reverse(*box_index))
        })
        .map(|(_, _, box_index)| box_index)
}

fn choose_greedy_move(situation: &PigeonSituation) -> PigeonMove {
    let view = &situation.view;
    let target_box = view.last_crumb_box.unwrap_or(view.sandwich_box);
    match situation.state {
        PigeonState::Perched { box_index }
            if box_index == target_box || view.has_food_on(box_index) =>
        {
            peck_when_ready(situation.can_peck)
        }
        PigeonState::Hovering | PigeonState::Perched { .. } => fly_when_room(view, target_box),
        PigeonState::Flying { .. } | PigeonState::Stunned { .. } => PigeonMove::Wait,
    }
}

fn choose_nervous_move(situation: &PigeonSituation) -> PigeonMove {
    let view = &situation.view;
    let home_box = view.sandwich_box;
    match situation.state {
        PigeonState::Perched { box_index } | PigeonState::Flying { box_index, .. }
            if view.is_hand_over(box_index) =>
        {
            PigeonMove::TakeOff
        }
        PigeonState::Hovering if view.is_hand_over(home_box) => PigeonMove::Wait,
        PigeonState::Perched { box_index } if view.has_food_on(box_index) => {
            peck_when_ready(situation.can_peck)
        }
        PigeonState::Hovering | PigeonState::Perched { .. } => fly_when_room(view, home_box),
        PigeonState::Flying { .. } | PigeonState::Stunned { .. } => PigeonMove::Wait,
    }
}

fn choose_vulture_move(situation: &PigeonSituation) -> PigeonMove {
    let view = &situation.view;
    match situation.state {
        PigeonState::Hovering => richest_loose_box(view)
            .map_or(PigeonMove::Wait, PigeonMove::FlyTo),
        PigeonState::Perched { box_index } if view.loose_on(box_index) > 0 => {
            peck_when_ready(situation.can_peck)
        }
        PigeonState::Perched { .. } => PigeonMove::TakeOff,
        PigeonState::Flying { .. } | PigeonState::Stunned { .. } => PigeonMove::Wait,
    }
}

fn richest_loose_box(view: &TableView) -> Option<u8> {
    (0..view.box_count)
        .filter(|box_index| view.loose_on(*box_index) > 0 && view.has_room_on(*box_index))
        .max_by_key(|box_index| (view.loose_on(*box_index), core::cmp::Reverse(*box_index)))
}

fn peck_when_ready(can_peck: bool) -> PigeonMove {
    if can_peck {
        PigeonMove::Peck
    } else {
        PigeonMove::Wait
    }
}

fn fly_when_room(view: &TableView, target_box: u8) -> PigeonMove {
    if view.has_room_on(target_box) {
        PigeonMove::FlyTo(target_box)
    } else {
        PigeonMove::Wait
    }
}
