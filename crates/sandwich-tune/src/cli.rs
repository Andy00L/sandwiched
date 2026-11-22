use std::path::PathBuf;

pub const USAGE: &str = "usage: sandwich-tune record --players <2..21> --seed <number> --out <file> | balance --players <2..21> --rounds <number> --seed <number> [--swat-cooldown-ms <ms>] [--swat-stun-ms <ms>] [--peck-cooldown-ms <ms>] [--empty-stun-ms <ms>] [--windup-ms <ms>]";
const JS_MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command {
    Record(RecordRequest),
    Balance(BalanceRequest),
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TimingOverrides {
    pub swat_cooldown_ms: Option<u64>,
    pub swat_stun_ms: Option<u64>,
    pub peck_cooldown_ms: Option<u64>,
    pub empty_stun_ms: Option<u64>,
    pub windup_ms: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BalanceRequest {
    pub players: u8,
    pub rounds: u64,
    pub seed: u64,
    pub overrides: TimingOverrides,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordRequest {
    pub players: u8,
    pub seed: u64,
    pub out_path: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CliError {
    MissingCommand,
    UnknownCommand(String),
    UnknownFlag(String),
    MissingValue(&'static str),
    BadNumber { flag: &'static str, value: String },
    SeedTooLarge(u64),
}

impl core::fmt::Display for CliError {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            CliError::MissingCommand => write!(formatter, "no command given. {USAGE}"),
            CliError::UnknownCommand(command) => {
                write!(formatter, "unknown command {command:?}. {USAGE}")
            }
            CliError::UnknownFlag(flag) => write!(formatter, "unknown flag {flag:?}. {USAGE}"),
            CliError::MissingValue(flag) => write!(formatter, "{flag} needs a value. {USAGE}"),
            CliError::BadNumber { flag, value } => {
                write!(formatter, "{flag} takes a whole number, not {value:?}")
            }
            CliError::SeedTooLarge(seed) => write!(
                formatter,
                "seed {seed} is above {JS_MAX_SAFE_INTEGER}, which JavaScript cannot read exactly"
            ),
        }
    }
}

pub fn parse_command(arguments: &[String]) -> Result<Command, CliError> {
    let Some((command, flags)) = arguments.split_first() else {
        return Err(CliError::MissingCommand);
    };
    match command.as_str() {
        "record" => parse_record_flags(flags).map(Command::Record),
        "balance" => parse_balance_flags(flags).map(Command::Balance),
        _ => Err(CliError::UnknownCommand(command.clone())),
    }
}

fn parse_record_flags(flags: &[String]) -> Result<RecordRequest, CliError> {
    let mut players = None;
    let mut seed = None;
    let mut out_path = None;
    let mut remaining = flags.iter();
    while let Some(flag) = remaining.next() {
        match flag.as_str() {
            "--players" => players = Some(parse_number("--players", remaining.next())?),
            "--seed" => seed = Some(parse_number("--seed", remaining.next())?),
            "--out" => {
                let value = remaining.next().ok_or(CliError::MissingValue("--out"))?;
                out_path = Some(PathBuf::from(value));
            }
            _ => return Err(CliError::UnknownFlag(flag.clone())),
        }
    }
    let seed: u64 = seed.ok_or(CliError::MissingValue("--seed"))?;
    if seed > JS_MAX_SAFE_INTEGER {
        return Err(CliError::SeedTooLarge(seed));
    }
    Ok(RecordRequest {
        players: players.ok_or(CliError::MissingValue("--players"))?,
        seed,
        out_path: out_path.ok_or(CliError::MissingValue("--out"))?,
    })
}

fn parse_balance_flags(flags: &[String]) -> Result<BalanceRequest, CliError> {
    let mut players = None;
    let mut rounds = None;
    let mut seed = None;
    let mut overrides = TimingOverrides::default();
    let mut remaining = flags.iter();
    while let Some(flag) = remaining.next() {
        match flag.as_str() {
            "--players" => players = Some(parse_number("--players", remaining.next())?),
            "--rounds" => rounds = Some(parse_number("--rounds", remaining.next())?),
            "--seed" => seed = Some(parse_number("--seed", remaining.next())?),
            "--swat-cooldown-ms" => overrides.swat_cooldown_ms = Some(parse_number("--swat-cooldown-ms", remaining.next())?),
            "--swat-stun-ms" => overrides.swat_stun_ms = Some(parse_number("--swat-stun-ms", remaining.next())?),
            "--peck-cooldown-ms" => overrides.peck_cooldown_ms = Some(parse_number("--peck-cooldown-ms", remaining.next())?),
            "--empty-stun-ms" => overrides.empty_stun_ms = Some(parse_number("--empty-stun-ms", remaining.next())?),
            "--windup-ms" => overrides.windup_ms = Some(parse_number("--windup-ms", remaining.next())?),
            _ => return Err(CliError::UnknownFlag(flag.clone())),
        }
    }
    Ok(BalanceRequest {
        players: players.ok_or(CliError::MissingValue("--players"))?,
        rounds: rounds.ok_or(CliError::MissingValue("--rounds"))?,
        seed: seed.ok_or(CliError::MissingValue("--seed"))?,
        overrides,
    })
}

fn parse_number<Number: core::str::FromStr>(
    flag: &'static str,
    value: Option<&String>,
) -> Result<Number, CliError> {
    let text = value.ok_or(CliError::MissingValue(flag))?;
    text.parse()
        .map_err(|_| CliError::BadNumber { flag, value: text.clone() })
}
