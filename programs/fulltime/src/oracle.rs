//! CPI layer for the TxLINE `txoracle` program's `validate_stat` instruction.
//!
//! Struct layouts mirror the published devnet IDL byte-for-byte (borsh).
//! `validate_stat` verifies a Merkle proof chain (stat -> event stat root ->
//! fixture subtree -> daily main tree root stored on-chain) and evaluates
//! `(stat_a [op stat_b]) <comparison> threshold`, returning the verdict as a
//! borsh bool in return data. Invalid proofs error (oracle codes 6003/6004),
//! so a returned bool always means "proof valid, predicate = <bool>".

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{get_return_data, invoke},
};

use crate::state::{BinaryOp, Comparison};

/// `validate_stat` anchor discriminator (from devnet IDL).
pub const VALIDATE_STAT_DISCRIMINATOR: [u8; 8] = [107, 197, 232, 90, 191, 136, 105, 185];

/// PDA seed for the oracle's daily scores Merkle-roots account.
pub const DAILY_SCORES_ROOTS_SEED: &[u8] = b"daily_scores_roots";

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ScoresUpdateStats {
    pub update_count: i32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ScoresBatchSummary {
    pub fixture_id: i64,
    pub update_stats: ScoresUpdateStats,
    pub events_sub_tree_root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct ScoreStat {
    pub key: u32,
    pub value: i32,
    pub period: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct StatTerm {
    pub stat_to_prove: ScoreStat,
    pub event_stat_root: [u8; 32],
    pub stat_proof: Vec<ProofNode>,
}

/// Oracle-side predicate. `Comparison`/`BinaryOp` variant order matches the
/// oracle IDL, so our local enums serialize identically.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct TraderPredicate {
    pub threshold: i32,
    pub comparison: Comparison,
}

/// Full argument set for one validate_stat invocation (minus the predicate,
/// which the *market* dictates — never the caller).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ValidationBundle {
    pub ts: i64,
    pub fixture_summary: ScoresBatchSummary,
    pub fixture_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
    pub stat_a: StatTerm,
    pub stat_b: Option<StatTerm>,
}

#[derive(AnchorSerialize)]
struct ValidateStatArgs<'a> {
    ts: i64,
    fixture_summary: &'a ScoresBatchSummary,
    fixture_proof: &'a Vec<ProofNode>,
    main_tree_proof: &'a Vec<ProofNode>,
    predicate: TraderPredicate,
    stat_a: &'a StatTerm,
    stat_b: &'a Option<StatTerm>,
    op: Option<BinaryOp>,
}

/// CPI into txoracle::validate_stat. Returns the predicate verdict.
/// Errors if the oracle rejects the proof chain.
pub fn validate_stat_cpi(
    oracle_program: &AccountInfo,
    daily_scores_roots: &AccountInfo,
    bundle: &ValidationBundle,
    predicate: TraderPredicate,
    op: Option<BinaryOp>,
) -> Result<bool> {
    let args = ValidateStatArgs {
        ts: bundle.ts,
        fixture_summary: &bundle.fixture_summary,
        fixture_proof: &bundle.fixture_proof,
        main_tree_proof: &bundle.main_tree_proof,
        predicate,
        stat_a: &bundle.stat_a,
        stat_b: &bundle.stat_b,
        op,
    };
    let mut data = VALIDATE_STAT_DISCRIMINATOR.to_vec();
    args.serialize(&mut data)?;

    let ix = Instruction {
        program_id: *oracle_program.key,
        accounts: vec![AccountMeta::new_readonly(*daily_scores_roots.key, false)],
        data,
    };
    invoke(&ix, &[daily_scores_roots.clone()])?;

    let (from, ret) = get_return_data().ok_or(error!(crate::error::FulltimeError::OracleNoReturn))?;
    require_keys_eq!(
        from,
        *oracle_program.key,
        crate::error::FulltimeError::OracleNoReturn
    );
    Ok(ret.first().copied() == Some(1))
}

/// Derive the oracle's daily_scores_roots PDA for a unix-millisecond timestamp.
pub fn daily_scores_roots_pda(oracle_program_id: &Pubkey, ts_ms: i64) -> (Pubkey, u16) {
    let epoch_day = (ts_ms / 86_400_000) as u16;
    let (pda, _) = Pubkey::find_program_address(
        &[DAILY_SCORES_ROOTS_SEED, &epoch_day.to_le_bytes()],
        oracle_program_id,
    );
    (pda, epoch_day)
}
