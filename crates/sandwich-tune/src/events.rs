use crate::bots::Temperament;
use sandwich_rules::Timing;
use serde::Serialize;

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundHeader {
    pub version: u32,
    pub seed: u64,
    pub tick_ms: u64,
    pub box_count: u8,
    pub timing: TimingTicks,
    pub chips_per_ante: u64,
    pub players: Vec<PlayerEntry>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimingTicks {
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

impl From<Timing> for TimingTicks {
    fn from(timing: Timing) -> TimingTicks {
        let Timing {
            lobby_ticks,
            draw_timeout_ticks,
            hide_ticks,
            round_ticks,
            flight_ticks,
            peck_cooldown_ticks,
            empty_box_stun_ticks,
            swat_windup_ticks,
            swat_cooldown_ticks,
            swat_stun_ticks,
            switch_cooldown_ticks,
        } = timing;
        TimingTicks {
            lobby_ticks,
            draw_timeout_ticks,
            hide_ticks,
            round_ticks,
            flight_ticks,
            peck_cooldown_ticks,
            empty_box_stun_ticks,
            swat_windup_ticks,
            swat_cooldown_ticks,
            swat_stun_ticks,
            switch_cooldown_ticks,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerEntry {
    pub seat: u8,
    pub name: String,
    pub variant: u8,
    pub temperament: Temperament,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TimedEvent {
    pub tick: u64,
    #[serde(flatten)]
    pub event: RoundEvent,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RoundEvent {
    SeatJoined {
        seat: u8,
    },
    Anted {
        seat: u8,
    },
    WhaleDrawn {
        whale_seat: u8,
        sandwich_box: u8,
        end_tick: u64,
    },
    Flew {
        seat: u8,
        #[serde(rename = "box")]
        box_index: u8,
        lands_tick: u64,
    },
    Landed {
        seat: u8,
        #[serde(rename = "box")]
        box_index: u8,
    },
    TookOff {
        seat: u8,
    },
    Pecked {
        seat: u8,
        #[serde(rename = "box")]
        box_index: u8,
        #[serde(flatten)]
        result: PeckResult,
    },
    HandRaised {
        #[serde(rename = "box")]
        box_index: u8,
        swat_number: u64,
        lands_tick: u64,
    },
    SwatLanded {
        #[serde(rename = "box")]
        box_index: u8,
        swat_number: u64,
        hits: Vec<SwatHit>,
    },
    StunEnded {
        seat: u8,
    },
    Settled {
        whale_crumbs: u64,
        pigeon_crumbs: u64,
        beaks: Vec<SeatCrumbs>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PeckResult {
    LooseCrumb,
    SandwichCrumb,
    EmptyBox { until_tick: u64 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwatHit {
    pub seat: u8,
    pub dropped_crumbs: u64,
    pub until_tick: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeatCrumbs {
    pub seat: u8,
    pub crumbs: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordedRound {
    pub header: RoundHeader,
    pub events: Vec<TimedEvent>,
}

#[derive(Debug)]
pub enum RenderError {
    Json(serde_json::Error),
    HeaderNotAnObject,
}

impl From<serde_json::Error> for RenderError {
    fn from(error: serde_json::Error) -> RenderError {
        RenderError::Json(error)
    }
}

impl core::fmt::Display for RenderError {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            RenderError::Json(error) => write!(formatter, "could not write JSON: {error}"),
            RenderError::HeaderNotAnObject => write!(formatter, "the header is not a JSON object"),
        }
    }
}

pub fn render_round_file(round: &RecordedRound) -> Result<String, RenderError> {
    let header_json = serde_json::to_string_pretty(&round.header)?;
    let header_fields = header_json
        .strip_suffix("\n}")
        .ok_or(RenderError::HeaderNotAnObject)?;
    let event_lines = round
        .events
        .iter()
        .map(serde_json::to_string)
        .collect::<Result<Vec<String>, serde_json::Error>>()?;
    Ok(format!(
        "{header_fields},\n  \"events\": [\n    {}\n  ]\n}}\n",
        event_lines.join(",\n    ")
    ))
}
