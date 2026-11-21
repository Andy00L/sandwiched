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
    pub fn from_tick_ms(tick_ms: u64) -> Result<Timing, RuleError> {
        if tick_ms == 0 {
            return Err(RuleError::ZeroTickLength);
        }
        let to_ticks = |duration_ms: u64| duration_ms.div_ceil(tick_ms).max(1);
        Ok(Timing {
            lobby_ticks: to_ticks(LOBBY_MS),
            draw_timeout_ticks: to_ticks(DRAW_TIMEOUT_MS),
            hide_ticks: to_ticks(HIDE_MS),
            round_ticks: to_ticks(ROUND_MS),
            flight_ticks: to_ticks(FLIGHT_MS),
            peck_cooldown_ticks: to_ticks(PECK_COOLDOWN_MS),
            empty_box_stun_ticks: to_ticks(EMPTY_BOX_STUN_MS),
            swat_windup_ticks: to_ticks(SWAT_WINDUP_MS),
            swat_cooldown_ticks: to_ticks(SWAT_COOLDOWN_MS),
            swat_stun_ticks: to_ticks(SWAT_STUN_MS),
            switch_cooldown_ticks: to_ticks(SWITCH_COOLDOWN_MS),
        })
    }
}
