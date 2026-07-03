use anchor_lang::prelude::*;

/// Which way a binary market's predicate compares `(stat_a [op stat_b])` to `threshold`.
/// Mirrors the TxLINE oracle's `Comparison` enum ordering exactly (borsh variant indexes).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Comparison {
    GreaterThan,
    LessThan,
    EqualTo,
}

/// Mirrors the TxLINE oracle's `BinaryExpression` enum ordering exactly.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum BinaryOp {
    Add,
    Subtract,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum MarketStatus {
    Open,
    ResolvedYes,
    ResolvedNo,
    Voided,
}

/// A binary prediction market over a TxLINE-verifiable stat predicate.
///
/// Example: "combined corners > 10" =>
///   stat_key_a = 7 (P1 corners), stat_key_b = Some(8) (P2 corners),
///   op = Some(Add), comparison = GreaterThan, threshold = 10.
#[account]
#[derive(InitSpace)]
pub struct Market {
    pub creator: Pubkey,
    pub market_id: u64,
    /// TxLINE fixture this market settles against.
    pub fixture_id: i64,
    /// Period-encoded TxLINE stat keys (period * 1000 + base_key).
    pub stat_key_a: u32,
    pub stat_key_b: Option<u32>,
    pub op: Option<BinaryOp>,
    pub comparison: Comparison,
    pub threshold: i32,
    /// Stake token mint (devnet test USDC/USDT). All amounts in its base units.
    pub mint: Pubkey,
    /// TxLINE oracle program this market settles through (pinned at creation).
    pub oracle_program: Pubkey,
    /// FPMM virtual reserves. Invariant: every deposited token mints one
    /// YES + one NO pair into the pool, so outstanding user shares are always
    /// fully collateralized by the vault.
    pub pool_yes: u64,
    pub pool_no: u64,
    /// Creator's initial liquidity deposit (claimable back on void / after resolution).
    pub seed_liquidity: u64,
    /// Earliest unix time (seconds) resolution may be attempted (~ scheduled FT).
    pub resolve_after_ts: i64,
    /// Extra seconds after the proven stat packet's timestamp before it is
    /// accepted as final (VAR / correction window).
    pub finality_delay_secs: u32,
    /// After this unix time (seconds) an unresolved market can be voided and refunded.
    pub void_after_ts: i64,
    pub status: MarketStatus,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Market {
    pub const SEED: &'static [u8] = b"market";
    pub const VAULT_SEED: &'static [u8] = b"vault";
}

/// A user's cumulative position in one market.
#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub yes_shares: u64,
    pub no_shares: u64,
    /// Total stake paid in, for pro-rata refunds on void.
    pub cost_paid: u64,
    pub claimed: bool,
    pub bump: u8,
}

impl Position {
    pub const SEED: &'static [u8] = b"position";
}
