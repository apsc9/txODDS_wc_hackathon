use anchor_lang::prelude::*;

#[error_code]
pub enum FulltimeError {
    #[msg("Market is not open for this action")]
    MarketNotOpen,
    #[msg("Market is not resolved yet")]
    MarketNotResolved,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Slippage: fewer shares out than min_shares_out")]
    SlippageExceeded,
    #[msg("AMM math overflow")]
    MathOverflow,
    #[msg("Too early to resolve this market")]
    ResolveTooEarly,
    #[msg("Proven stat packet predates the market's resolve window")]
    StalePacket,
    #[msg("Finality gate: packet too recent, VAR window still open")]
    FinalityGateOpen,
    #[msg("Proof fixture does not match this market's fixture")]
    FixtureMismatch,
    #[msg("Proof stat keys do not match this market's stat keys")]
    StatKeyMismatch,
    #[msg("Wrong daily scores roots account for the packet timestamp")]
    WrongRootsAccount,
    #[msg("Wrong oracle program")]
    WrongOracleProgram,
    #[msg("Oracle returned no return data")]
    OracleNoReturn,
    #[msg("Void deadline not reached")]
    VoidTooEarly,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Only the market creator may do this")]
    NotCreator,
    #[msg("Invalid market timing parameters")]
    InvalidTiming,
}
