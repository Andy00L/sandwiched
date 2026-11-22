mod bots;
mod cli;
mod events;
mod random;
mod simulation;
mod summary;

use cli::{parse_command, CliError, Command, RecordRequest};
use events::{render_round_file, RenderError};
use simulation::{simulate_round, RoundConfig, SimulationError};
use std::process::ExitCode;
use summary::summarize_round;

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
    }
}

fn record_round(request: &RecordRequest) -> Result<String, ToolError> {
    let config = RoundConfig { players: request.players, seed: request.seed };
    let round = simulate_round(config).map_err(ToolError::Simulation)?;
    let file_text = render_round_file(&round).map_err(ToolError::Render)?;
    let path = request.out_path.display().to_string();
    std::fs::write(&request.out_path, file_text)
        .map_err(|error| ToolError::Write { path: path.clone(), error })?;
    Ok(format!("wrote {path}: {}", summarize_round(&round)))
}
