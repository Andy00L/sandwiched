use crate::constants::{MAX_BOXES, MAX_SEATS, MIN_PLAYERS};
use crate::error::RuleError;
use crate::timing::Timing;

const WHALE_BYTES: core::ops::Range<usize> = 0..8;
const BOX_BYTES: core::ops::Range<usize> = 8..16;

pub fn can_start_round(
    anted_players: u8,
    seated_players: u8,
    first_ante_tick: u64,
    now_tick: u64,
    timing: &Timing,
) -> Result<(), RuleError> {
    if anted_players < MIN_PLAYERS {
        return Err(RuleError::TooFewPlayers);
    }
    if usize::from(anted_players) > MAX_SEATS {
        return Err(RuleError::TooManyPlayers);
    }
    let lobby_closes_tick = first_ante_tick
        .checked_add(timing.lobby_ticks)
        .ok_or(RuleError::MathOverflow)?;
    let is_everyone_in = anted_players == seated_players;
    if !is_everyone_in && now_tick < lobby_closes_tick {
        return Err(RuleError::LobbyStillOpen);
    }
    Ok(())
}

pub fn pick_whale(randomness: &[u8; 32], anted_players: u8) -> Result<u8, RuleError> {
    if anted_players < MIN_PLAYERS {
        return Err(RuleError::TooFewPlayers);
    }
    if usize::from(anted_players) > MAX_SEATS {
        return Err(RuleError::TooManyPlayers);
    }
    Ok(bounded_from_bytes(&randomness[WHALE_BYTES], anted_players))
}

pub fn pick_default_box(randomness: &[u8; 32], box_count: u8) -> Result<u8, RuleError> {
    if box_count == 0 || usize::from(box_count) > MAX_BOXES {
        return Err(RuleError::BadBoxCount);
    }
    Ok(bounded_from_bytes(&randomness[BOX_BYTES], box_count))
}

fn bounded_from_bytes(bytes: &[u8], upper_bound: u8) -> u8 {
    let mut value: u64 = 0;
    for (position, byte) in bytes.iter().take(8).enumerate() {
        value |= u64::from(*byte) << (8 * position);
    }
    (value % u64::from(upper_bound)) as u8
}
