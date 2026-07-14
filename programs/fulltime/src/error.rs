use anchor_lang::prelude::*;

#[error_code]
pub enum FulltimeError {
    #[msg("Market not open")]
    MarketNotOpen,
    #[msg("Not resolved")]
    MarketNotResolved,
    #[msg("Zero amount")]
    ZeroAmount,
    #[msg("Slippage exceeded")]
    SlippageExceeded,
    #[msg("AMM math overflow")]
    MathOverflow,
    #[msg("Too early to resolve")]
    ResolveTooEarly,
    #[msg("Stat packet predates resolve window")]
    StalePacket,
    #[msg("Packet inside finality delay")]
    FinalityGateOpen,
    #[msg("Fixture mismatch")]
    FixtureMismatch,
    #[msg("Stat key mismatch")]
    StatKeyMismatch,
    #[msg("Wrong daily scores roots account")]
    WrongRootsAccount,
    #[msg("Wrong oracle program")]
    WrongOracleProgram,
    #[msg("No oracle return data")]
    OracleNoReturn,
    #[msg("Void deadline not reached")]
    VoidTooEarly,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Not the market creator")]
    NotCreator,
    #[msg("Invalid market timing parameters")]
    InvalidTiming,
    #[msg("Trading closed")]
    TradingClosed,
}
