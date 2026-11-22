mod bots;
mod cli;
mod events;
mod random;
mod simulation;
mod summary;

use cli::{parse_command, BalanceRequest, CliError, Command, RecordRequest, TimingOverrides};
use events::{render_round_file, RenderError};
use sandwich_rules::Timing;
use simulation::{simulate_round, standard_timing, RoundConfig, SimulationError, TICK_MS};
use std::process::ExitCode;
use summary::{summarize_rounds, summarize_round};

enum ToolError {
    Cli(CliError),
    Simulation(SimulationError),
    Render(RenderError),
    Write { path: String, error: std::io::Error },
}

impl core::fmt::Display for ToolError {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            ToolError::Cli(error) => write!(formatter, "{error}"),
            ToolError::Simulation(error) => write!(formatter, "simulation failed: {error}"),
            ToolError::Render(error) => write!(formatter, "{error}"),
            ToolError::Write { path, error } => write!(formatter, "could not write {path}: {error}"),
        }
    }
}

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    match run_command(&arguments) {
        Ok(report) => {
            println!("[main] {report}");
            ExitCode::SUCCESS
        }
        Err(failure) => {
            eprintln!("[main] {failure}");
            ExitCode::FAILURE
        }
    }
}

fn run_command(arguments: &[String]) -> Result<String, ToolError> {
    match parse_command(arguments).map_err(ToolError::Cli)? {
        Command::Record(request) => record_round(&request),
        Command::Balance(request) => measure_balance(&request),
    }
}

fn ticks_from_override(override_ms: Option<u64>, standard_ticks: u64) -> u64 {
    override_ms.map_or(standard_ticks, |duration_ms| duration_ms.div_ceil(TICK_MS).max(1))
}

fn apply_overrides(standard: Timing, overrides: &TimingOverrides) -> Timing {
    Timing {
        swat_cooldown_ticks: ticks_from_override(overrides.swat_cooldown_ms, standard.swat_cooldown_ticks),
        swat_stun_ticks: ticks_from_override(overrides.swat_stun_ms, standard.swat_stun_ticks),
        peck_cooldown_ticks: ticks_from_override(overrides.peck_cooldown_ms, standard.peck_cooldown_ticks),
        empty_box_stun_ticks: ticks_from_override(overrides.empty_stun_ms, standard.empty_box_stun_ticks),
        swat_windup_ticks: ticks_from_override(overrides.windup_ms, standard.swat_windup_ticks),
        ..standard
    }
}

fn measure_balance(request: &BalanceRequest) -> Result<String, ToolError> {
    let timing = apply_overrides(standard_timing().map_err(ToolError::Simulation)?, &request.overrides);
    let rounds = (0..request.rounds)
        .map(|offset| simulate_round(RoundConfig { players: request.players, seed: request.seed + offset, timing }))
        .collect::<Result<Vec<_>, _>>()
        .map_err(ToolError::Simulation)?;
    let summaries: Vec<_> = rounds.iter().map(summarize_round).collect();
    Ok(format!("{:?}: {}", request.overrides, summarize_rounds(&summaries)))
}

fn record_round(request: &RecordRequest) -> Result<String, ToolError> {
    let config = RoundConfig { players: request.players, seed: request.seed, timing: standard_timing().map_err(ToolError::Simulation)? };
    let round = simulate_round(config).map_err(ToolError::Simulation)?;
    let file_text = render_round_file(&round).map_err(ToolError::Render)?;
    let path = request.out_path.display().to_string();
    std::fs::write(&request.out_path, file_text)
        .map_err(|error| ToolError::Write { path: path.clone(), error })?;
    Ok(format!("wrote {path}: {}", summarize_round(&round)))
}
