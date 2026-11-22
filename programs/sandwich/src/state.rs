use anchor_lang::prelude::*;
use sandwich_rules::constants::{MAX_BOXES, MAX_SEATS, SWAT_HISTORY_LEN};
use sandwich_rules::{Hand, Pigeon, PigeonState, Round, Swat};

#[account]
#[derive(InitSpace)]
pub struct Table {
    pub bump: u8,
    pub custody_bump: u8,
    pub table_id: u64,
    pub validator: Pubkey,
    pub mint: Pubkey,
    pub escrow: Pubkey,
    pub ante_units: u64,
    pub chip_units: u64,
    pub box_count: u8,
    pub round_number: u64,
    pub seats: [Pubkey; MAX_SEATS],
    pub anted: u32,
    pub phase: Phase,
    pub round: StoredRound,
    pub last_result: Option<RoundResult>,
}

#[account]
#[derive(InitSpace)]
pub struct Seat {
    pub bump: u8,
    pub wallet: Pubkey,
    pub seat_index: Option<u8>,
    pub chips: u64,
    pub pigeon: StoredPigeon,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Phase {
    Lobby { first_ante_tick: u64 },
    Drawing { requested_tick: u64 },
    Live { whale_seat: u8 },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub struct RoundResult {
    pub round_number: u64,
    pub whale_wallet: Pubkey,
    pub sandwich_box: u8,
    pub whale_crumbs: u64,
    pub pigeon_crumbs: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub struct StoredRound {
    pub box_count: u8,
    pub sandwich_box: u8,
    pub end_tick: u64,
    pub anted_crumbs: u64,
    pub pot_crumbs: u64,
    pub loose_crumbs: [u64; MAX_BOXES],
    pub perch_claims: [u8; MAX_BOXES],
    pub hand: StoredHand,
    pub swats: [StoredSwat; SWAT_HISTORY_LEN],
    pub swat_count: u64,
    pub switch_count: u8,
    pub next_switch_tick: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum StoredHand {
    Idle { ready_tick: u64 },
    Raised { box_index: u8, lands_tick: u64 },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub struct StoredSwat {
    pub number: u64,
    pub box_index: u8,
    pub lands_tick: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub struct StoredPigeon {
    pub state: StoredPigeonState,
    pub beak_crumbs: u64,
    pub next_peck_tick: u64,
    pub last_swat_number: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum StoredPigeonState {
    Hovering,
    Flying { box_index: u8, lands_tick: u64 },
    Perched { box_index: u8 },
    Stunned { box_index: u8, until_tick: u64 },
}

const NO_SWAT: StoredSwat = StoredSwat { number: 0, box_index: 0, lands_tick: 0 };

impl StoredRound {
    pub const EMPTY: StoredRound = StoredRound {
        box_count: 0,
        sandwich_box: 0,
        end_tick: 0,
        anted_crumbs: 0,
        pot_crumbs: 0,
        loose_crumbs: [0; MAX_BOXES],
        perch_claims: [0; MAX_BOXES],
        hand: StoredHand::Idle { ready_tick: 0 },
        swats: [NO_SWAT; SWAT_HISTORY_LEN],
        swat_count: 0,
        switch_count: 0,
        next_switch_tick: 0,
    };
}

impl From<Round> for StoredRound {
    fn from(round: Round) -> StoredRound {
        StoredRound {
            box_count: round.box_count,
            sandwich_box: round.sandwich_box,
            end_tick: round.end_tick,
            anted_crumbs: round.anted_crumbs,
            pot_crumbs: round.pot_crumbs,
            loose_crumbs: round.loose_crumbs,
            perch_claims: round.perch_claims,
            hand: round.hand.into(),
            swats: round.swats.map(StoredSwat::from),
            swat_count: round.swat_count,
            switch_count: round.switch_count,
            next_switch_tick: round.next_switch_tick,
        }
    }
}

impl From<StoredRound> for Round {
    fn from(stored: StoredRound) -> Round {
        Round {
            box_count: stored.box_count,
            sandwich_box: stored.sandwich_box,
            end_tick: stored.end_tick,
            anted_crumbs: stored.anted_crumbs,
            pot_crumbs: stored.pot_crumbs,
            loose_crumbs: stored.loose_crumbs,
            perch_claims: stored.perch_claims,
            hand: stored.hand.into(),
            swats: stored.swats.map(Swat::from),
            swat_count: stored.swat_count,
            switch_count: stored.switch_count,
            next_switch_tick: stored.next_switch_tick,
        }
    }
}

impl From<Hand> for StoredHand {
    fn from(hand: Hand) -> StoredHand {
        match hand {
            Hand::Idle { ready_tick } => StoredHand::Idle { ready_tick },
            Hand::Raised { box_index, lands_tick } => StoredHand::Raised { box_index, lands_tick },
        }
    }
}

impl From<StoredHand> for Hand {
    fn from(stored: StoredHand) -> Hand {
        match stored {
            StoredHand::Idle { ready_tick } => Hand::Idle { ready_tick },
            StoredHand::Raised { box_index, lands_tick } => Hand::Raised { box_index, lands_tick },
        }
    }
}

impl From<Swat> for StoredSwat {
    fn from(swat: Swat) -> StoredSwat {
        StoredSwat { number: swat.number, box_index: swat.box_index, lands_tick: swat.lands_tick }
    }
}

impl From<StoredSwat> for Swat {
    fn from(stored: StoredSwat) -> Swat {
        Swat { number: stored.number, box_index: stored.box_index, lands_tick: stored.lands_tick }
    }
}

impl From<Pigeon> for StoredPigeon {
    fn from(pigeon: Pigeon) -> StoredPigeon {
        StoredPigeon {
            state: pigeon.state.into(),
            beak_crumbs: pigeon.beak_crumbs,
            next_peck_tick: pigeon.next_peck_tick,
            last_swat_number: pigeon.last_swat_number,
        }
    }
}

impl From<StoredPigeon> for Pigeon {
    fn from(stored: StoredPigeon) -> Pigeon {
        Pigeon {
            state: stored.state.into(),
            beak_crumbs: stored.beak_crumbs,
            next_peck_tick: stored.next_peck_tick,
            last_swat_number: stored.last_swat_number,
        }
    }
}

impl From<PigeonState> for StoredPigeonState {
    fn from(state: PigeonState) -> StoredPigeonState {
        match state {
            PigeonState::Hovering => StoredPigeonState::Hovering,
            PigeonState::Flying { box_index, lands_tick } => {
                StoredPigeonState::Flying { box_index, lands_tick }
            }
            PigeonState::Perched { box_index } => StoredPigeonState::Perched { box_index },
            PigeonState::Stunned { box_index, until_tick } => {
                StoredPigeonState::Stunned { box_index, until_tick }
            }
        }
    }
}

impl From<StoredPigeonState> for PigeonState {
    fn from(stored: StoredPigeonState) -> PigeonState {
        match stored {
            StoredPigeonState::Hovering => PigeonState::Hovering,
            StoredPigeonState::Flying { box_index, lands_tick } => {
                PigeonState::Flying { box_index, lands_tick }
            }
            StoredPigeonState::Perched { box_index } => PigeonState::Perched { box_index },
            StoredPigeonState::Stunned { box_index, until_tick } => {
                PigeonState::Stunned { box_index, until_tick }
            }
        }
    }
}
