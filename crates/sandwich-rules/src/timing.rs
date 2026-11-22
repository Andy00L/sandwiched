use crate::constants::{
    DRAW_TIMEOUT_MS, EMPTY_BOX_STUN_MS, FLIGHT_MS, HIDE_MS, LOBBY_MS, PECK_COOLDOWN_MS, ROUND_MS,
    SWAT_COOLDOWN_MS, SWAT_STUN_MS, SWAT_WINDUP_MS, SWITCH_COOLDOWN_MS,
};
use crate::error::RuleError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Timing {
    pub lobby_ticks: u64,
    pub draw_timeout_ticks: u64,
    pub hide_ticks: u64,
    pub round_ticks: u64,
    pub flight_ticks: u64,
    pub peck_cooldown_ticks: u64,
    pub empty_box_stun_ticks: u64,
    pub swat_windup_ticks: u64,
    pub swat_cooldown_ticks: u64,
    pub swat_stun_ticks: u64,
    pub switch_cooldown_ticks: u64,
}

impl Timing {
    pub const fn from_tick_ms(tick_ms: u64) -> Result<Timing, RuleError> {
        if tick_ms == 0 {
            return Err(RuleError::ZeroTickLength);
        }
        Ok(Timing {
            lobby_ticks: duration_in_ticks(LOBBY_MS, tick_ms),
            draw_timeout_ticks: duration_in_ticks(DRAW_TIMEOUT_MS, tick_ms),
            hide_ticks: duration_in_ticks(HIDE_MS, tick_ms),
            round_ticks: duration_in_ticks(ROUND_MS, tick_ms),
            flight_ticks: duration_in_ticks(FLIGHT_MS, tick_ms),
            peck_cooldown_ticks: duration_in_ticks(PECK_COOLDOWN_MS, tick_ms),
            empty_box_stun_ticks: duration_in_ticks(EMPTY_BOX_STUN_MS, tick_ms),
            swat_windup_ticks: duration_in_ticks(SWAT_WINDUP_MS, tick_ms),
            swat_cooldown_ticks: duration_in_ticks(SWAT_COOLDOWN_MS, tick_ms),
            swat_stun_ticks: duration_in_ticks(SWAT_STUN_MS, tick_ms),
            switch_cooldown_ticks: duration_in_ticks(SWITCH_COOLDOWN_MS, tick_ms),
        })
    }
}

const fn duration_in_ticks(duration_ms: u64, tick_ms: u64) -> u64 {
    let ticks = duration_ms.div_ceil(tick_ms);
    if ticks == 0 {
        1
    } else {
        ticks
    }
}
