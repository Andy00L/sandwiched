use anchor_lang::prelude::*;
use sandwich_rules::RuleError;

/// Starts at 7000 because the session-keys program answers with codes 6000 to 6003 in the same
/// transaction, and the rollup returns errors only as text.
#[error_code(offset = 7000)]
pub enum SandwichError {
    #[msg("This action is not allowed in the current phase")]
    WrongPhase,
    #[msg("The seat has not joined the table")]
    NotSeated,
    #[msg("The seat has already anted this round")]
    AlreadyAnted,
    #[msg("The seat holds fewer chips than needed")]
    NotEnoughChips,
    #[msg("At least two seats must ante")]
    TooFewPlayers,
    #[msg("The lobby is still open")]
    LobbyStillOpen,
    #[msg("Only the whale can do that")]
    NotTheWhale,
    #[msg("The whale cannot peck or fly")]
    WhaleCannotPeck,
    #[msg("The pigeon is stunned")]
    Stunned,
    #[msg("The pigeon pecked too recently")]
    PeckTooSoon,
    #[msg("The pigeon is not perched on a box")]
    NotPerched,
    #[msg("Every perch on that box is taken")]
    BoxFull,
    #[msg("The hand is not ready")]
    HandBusy,
    #[msg("No switches left this round")]
    NoSwitchesLeft,
    #[msg("The sandwich moved too recently")]
    SwitchTooSoon,
    #[msg("The round is not over yet")]
    RoundNotOver,
    #[msg("The draw has not timed out yet")]
    DrawNotTimedOut,
    #[msg("Every seat at the table is taken")]
    TableFull,
    #[msg("There is no such box at this table")]
    BadBox,
    #[msg("A number overflowed")]
    MathOverflow,
    #[msg("Only the VRF program can deliver the draw")]
    NotVrf,
    #[msg("The signer is neither the seat's wallet nor a session for it")]
    NotSeatOwner,
    #[msg("The seat has already joined the table")]
    AlreadySeated,
    #[msg("The seat did not ante this round")]
    NotInRound,
    #[msg("The round is over")]
    RoundOver,
    #[msg("The pigeon is already on that box")]
    AlreadyThere,
    #[msg("The pigeon is already in the air")]
    AlreadyHovering,
    #[msg("A table has 1 to 3 boxes")]
    BadBoxCount,
    #[msg("The ante must be a positive multiple of 100 token units")]
    BadAnte,
    #[msg("The amount must be at least one chip")]
    ZeroChips,
    #[msg("The account is not a seat of this table")]
    NotTableSeat,
    #[msg("The same seat was passed twice")]
    DuplicateSeat,
    #[msg("An anted seat is missing")]
    MissingSeat,
    #[msg("The randomness belongs to an earlier draw")]
    StaleDraw,
    #[msg("The oracle queue is not the ephemeral queue")]
    UnknownQueue,
    #[msg("The token account has the wrong owner or mint")]
    WrongTokenAccount,
    #[msg("The chips at the table do not add up")]
    ChipsNotConserved,
    #[msg("The faucet gives once per wallet per hour")]
    FaucetCooldown,
    #[msg("The tick length must be positive")]
    BadTickLength,
    #[msg("The seat is in a round that is not settled")]
    StillInRound,
    #[msg("Cash out every chip before leaving")]
    ChipsRemaining,
    #[msg("The account is not a table of this program")]
    NotTable,
}

impl From<RuleError> for SandwichError {
    fn from(rule_error: RuleError) -> SandwichError {
        match rule_error {
            RuleError::ZeroTickLength => SandwichError::BadTickLength,
            RuleError::BadBox | RuleError::OneBoxCannotSwitch => SandwichError::BadBox,
            RuleError::BadBoxCount => SandwichError::BadBoxCount,
            RuleError::TooFewPlayers => SandwichError::TooFewPlayers,
            RuleError::TooManyPlayers => SandwichError::TableFull,
            RuleError::LobbyStillOpen => SandwichError::LobbyStillOpen,
            RuleError::RoundOver => SandwichError::RoundOver,
            RuleError::RoundNotOver => SandwichError::RoundNotOver,
            RuleError::Stunned => SandwichError::Stunned,
            RuleError::PeckTooSoon => SandwichError::PeckTooSoon,
            RuleError::NotPerched => SandwichError::NotPerched,
            RuleError::AlreadyThere => SandwichError::AlreadyThere,
            RuleError::AlreadyHovering => SandwichError::AlreadyHovering,
            RuleError::BoxFull => SandwichError::BoxFull,
            RuleError::HandBusy => SandwichError::HandBusy,
            RuleError::NoSwitchesLeft => SandwichError::NoSwitchesLeft,
            RuleError::SwitchTooSoon => SandwichError::SwitchTooSoon,
            RuleError::MathOverflow => SandwichError::MathOverflow,
            RuleError::ChipsNotConserved => SandwichError::ChipsNotConserved,
        }
    }
}
