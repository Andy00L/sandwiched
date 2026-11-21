#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PigeonState {
    Hovering,
    Flying { box_index: u8, lands_tick: u64 },
    Perched { box_index: u8 },
    Stunned { box_index: u8, until_tick: u64 },
}

impl PigeonState {
    pub fn settled_at(self, now_tick: u64) -> PigeonState {
        match self {
            PigeonState::Flying { box_index, lands_tick } if lands_tick <= now_tick => {
                PigeonState::Perched { box_index }
            }
            PigeonState::Stunned { box_index, until_tick } if until_tick <= now_tick => {
                PigeonState::Perched { box_index }
            }
            unchanged => unchanged,
        }
    }

    pub fn claimed_box(self) -> Option<u8> {
        match self {
            PigeonState::Hovering => None,
            PigeonState::Flying { box_index, .. }
            | PigeonState::Perched { box_index }
            | PigeonState::Stunned { box_index, .. } => Some(box_index),
        }
    }

    pub fn stands_on(self, box_index: u8, at_tick: u64) -> bool {
        match self {
            PigeonState::Hovering => false,
            PigeonState::Flying { box_index: target_box, lands_tick } => {
                target_box == box_index && lands_tick <= at_tick
            }
            PigeonState::Perched { box_index: perched_box } => perched_box == box_index,
            PigeonState::Stunned { box_index: stunned_box, until_tick } => {
                stunned_box == box_index && until_tick <= at_tick
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Pigeon {
    pub state: PigeonState,
    pub beak_crumbs: u64,
    pub next_peck_tick: u64,
    pub last_swat_number: u64,
}

impl Pigeon {
    pub fn at_round_start() -> Pigeon {
        Pigeon {
            state: PigeonState::Hovering,
            beak_crumbs: 0,
            next_peck_tick: 0,
            last_swat_number: 0,
        }
    }
}
