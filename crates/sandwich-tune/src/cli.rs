use std::path::PathBuf;

pub const USAGE: &str = "usage: sandwich-tune record --players <2..21> --seed <number> --out <file>";
const JS_MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command {
    Record(RecordRequest),
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

fn parse_number<Number: core::str::FromStr>(
    flag: &'static str,
    value: Option<&String>,
) -> Result<Number, CliError> {
    let text = value.ok_or(CliError::MissingValue(flag))?;
    text.parse()
        .map_err(|_| CliError::BadNumber { flag, value: text.clone() })
}
