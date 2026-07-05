//! FullTime — trustlessly-settled prediction markets on TxLINE-verified
//! World Cup data. Binary FPMM markets; resolution CPIs into the TxLINE
//! oracle's `validate_stat` with the market's own stored predicate, so no
//! admin key ever decides an outcome. Unresolvable markets void and refund.

pub mod amm;
pub mod error;
pub mod oracle;
pub mod state;

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use error::FulltimeError;
use oracle::{TraderPredicate, ValidationBundle};
use state::*;

declare_id!("2MzYe6Zo4AD2fuszYou7CcnVmo7cdq4WjKi8UERL652L");

/// Trading side of a binary market.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Yes,
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateMarketArgs {
    pub market_id: u64,
    pub fixture_id: i64,
    pub stat_key_a: u32,
    pub stat_key_b: Option<u32>,
    pub op: Option<BinaryOp>,
    pub comparison: Comparison,
    pub threshold: i32,
    pub seed_liquidity: u64,
    pub resolve_after_ts: i64,
    pub finality_delay_secs: u32,
    pub void_after_ts: i64,
}

#[program]
pub mod fulltime {
    use super::*;

    /// Permissionless market creation. Creator seeds the FPMM 50/50 with
    /// `seed_liquidity` stake tokens (reclaimable on void; pool remainder
    /// reclaimable after resolution).
    pub fn create_market(ctx: Context<CreateMarket>, args: CreateMarketArgs) -> Result<()> {
        require!(args.seed_liquidity > 0, FulltimeError::ZeroAmount);
        require!(
            args.void_after_ts > args.resolve_after_ts && args.resolve_after_ts > 0,
            FulltimeError::InvalidTiming
        );
        // Two-stat predicates need an operator; single-stat must not have one.
        require!(
            args.stat_key_b.is_some() == args.op.is_some(),
            FulltimeError::StatKeyMismatch
        );

        let market = &mut ctx.accounts.market;
        market.creator = ctx.accounts.creator.key();
        market.market_id = args.market_id;
        market.fixture_id = args.fixture_id;
        market.stat_key_a = args.stat_key_a;
        market.stat_key_b = args.stat_key_b;
        market.op = args.op;
        market.comparison = args.comparison;
        market.threshold = args.threshold;
        market.mint = ctx.accounts.mint.key();
        market.oracle_program = ctx.accounts.oracle_program.key();
        market.pool_yes = args.seed_liquidity;
        market.pool_no = args.seed_liquidity;
        market.seed_liquidity = args.seed_liquidity;
        market.resolve_after_ts = args.resolve_after_ts;
        market.finality_delay_secs = args.finality_delay_secs;
        market.void_after_ts = args.void_after_ts;
        market.status = MarketStatus::Open;
        market.bump = ctx.bumps.market;
        market.vault_bump = ctx.bumps.vault;

        transfer_in(&ctx.accounts.creator_token, &ctx.accounts.vault, &ctx.accounts.mint,
            &ctx.accounts.creator, &ctx.accounts.token_program, args.seed_liquidity)
    }

    /// Buy YES or NO shares with `amount_in` stake tokens.
    pub fn buy(ctx: Context<Buy>, side: Side, amount_in: u64, min_shares_out: u64) -> Result<()> {
        require!(amount_in > 0, FulltimeError::ZeroAmount);
        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Open, FulltimeError::MarketNotOpen);

        let (pool_this, pool_other) = match side {
            Side::Yes => (market.pool_yes, market.pool_no),
            Side::No => (market.pool_no, market.pool_yes),
        };
        let shares = amm::shares_out(pool_this, pool_other, amount_in)
            .ok_or(FulltimeError::MathOverflow)?;
        require!(shares >= min_shares_out, FulltimeError::SlippageExceeded);
        let (new_this, new_other) = amm::pools_after_buy(pool_this, pool_other, amount_in, shares)
            .ok_or(FulltimeError::MathOverflow)?;
        match side {
            Side::Yes => {
                market.pool_yes = new_this;
                market.pool_no = new_other;
            }
            Side::No => {
                market.pool_no = new_this;
                market.pool_yes = new_other;
            }
        }

        let position = &mut ctx.accounts.position;
        position.owner = ctx.accounts.buyer.key();
        position.market = market.key();
        position.bump = ctx.bumps.position;
        match side {
            Side::Yes => position.yes_shares = position.yes_shares.checked_add(shares).ok_or(FulltimeError::MathOverflow)?,
            Side::No => position.no_shares = position.no_shares.checked_add(shares).ok_or(FulltimeError::MathOverflow)?,
        }
        position.cost_paid = position.cost_paid.checked_add(amount_in).ok_or(FulltimeError::MathOverflow)?;

        transfer_in(&ctx.accounts.buyer_token, &ctx.accounts.vault, &ctx.accounts.mint,
            &ctx.accounts.buyer, &ctx.accounts.token_program, amount_in)
    }

    /// Permissionless resolution. Caller supplies only the proof bundle; the
    /// predicate is reconstructed from market state so a keeper can never
    /// steer the outcome — only prove it. Verification gates:
    ///   1. clock >= resolve_after_ts              (no mid-match settlement)
    ///   2. packet ts >= resolve_after_ts          (stat is from the final whistle window)
    ///   3. clock >= packet ts + finality_delay    (VAR / correction window elapsed)
    ///   4. fixture + stat keys match market       (proof is about *this* market)
    ///   5. daily roots PDA matches packet ts      (no root substitution)
    ///   6. oracle program matches pinned id       (no oracle substitution)
    pub fn resolve(ctx: Context<Resolve>, bundle: ValidationBundle) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Open, FulltimeError::MarketNotOpen);

        let now = Clock::get()?.unix_timestamp;
        let packet_ts_secs = bundle.ts / 1000;
        require!(now >= market.resolve_after_ts, FulltimeError::ResolveTooEarly);
        require!(packet_ts_secs >= market.resolve_after_ts, FulltimeError::StalePacket);
        require!(
            now >= packet_ts_secs + market.finality_delay_secs as i64,
            FulltimeError::FinalityGateOpen
        );

        require!(
            bundle.fixture_summary.fixture_id == market.fixture_id,
            FulltimeError::FixtureMismatch
        );
        require!(
            bundle.stat_a.stat_to_prove.key == market.stat_key_a,
            FulltimeError::StatKeyMismatch
        );
        match (market.stat_key_b, &bundle.stat_b) {
            (Some(key_b), Some(term_b)) => {
                require!(term_b.stat_to_prove.key == key_b, FulltimeError::StatKeyMismatch)
            }
            (None, None) => {}
            _ => return err!(FulltimeError::StatKeyMismatch),
        }

        require_keys_eq!(
            ctx.accounts.oracle_program.key(),
            market.oracle_program,
            FulltimeError::WrongOracleProgram
        );
        let (expected_roots, _) =
            oracle::daily_scores_roots_pda(&market.oracle_program, bundle.ts);
        require_keys_eq!(
            ctx.accounts.daily_scores_roots.key(),
            expected_roots,
            FulltimeError::WrongRootsAccount
        );

        let predicate = TraderPredicate {
            threshold: market.threshold,
            comparison: market.comparison,
        };
        let verdict = oracle::validate_stat_cpi(
            &ctx.accounts.oracle_program,
            &ctx.accounts.daily_scores_roots,
            &bundle,
            predicate,
            market.op,
        )?;

        market.status = if verdict {
            MarketStatus::ResolvedYes
        } else {
            MarketStatus::ResolvedNo
        };
        msg!(
            "market {} resolved {:?} via TxLINE proof (fixture {}, packet ts {})",
            market.market_id, market.status, market.fixture_id, bundle.ts
        );
        Ok(())
    }

    /// Redeem winning shares 1:1 (resolved) or refund cost basis (voided).
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let market = &ctx.accounts.market;
        let position = &mut ctx.accounts.position;
        require!(!position.claimed, FulltimeError::AlreadyClaimed);

        let amount = match market.status {
            MarketStatus::ResolvedYes => position.yes_shares,
            MarketStatus::ResolvedNo => position.no_shares,
            MarketStatus::Voided => position.cost_paid,
            MarketStatus::Open => return err!(FulltimeError::MarketNotResolved),
        };
        require!(amount > 0, FulltimeError::NothingToClaim);
        position.claimed = true;

        transfer_out(ctx.accounts.market.clone(), &ctx.accounts.vault,
            &ctx.accounts.claimer_token, &ctx.accounts.mint, &ctx.accounts.token_program, amount)
    }

    /// Void an unresolved market after its deadline (data outage, abandoned
    /// or cancelled fixture). Escrow never depends on TxODDS staying online.
    pub fn void_market(ctx: Context<VoidMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Open, FulltimeError::MarketNotOpen);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= market.void_after_ts, FulltimeError::VoidTooEarly);
        market.status = MarketStatus::Voided;
        msg!("market {} voided at {}", market.market_id, now);
        Ok(())
    }

    /// Creator reclaims pool-held value: winning-side pool shares after
    /// resolution, or the original seed liquidity after a void.
    pub fn withdraw_liquidity(ctx: Context<WithdrawLiquidity>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require_keys_eq!(ctx.accounts.creator.key(), market.creator, FulltimeError::NotCreator);

        let amount = match market.status {
            MarketStatus::ResolvedYes => market.pool_yes,
            MarketStatus::ResolvedNo => market.pool_no,
            MarketStatus::Voided => market.seed_liquidity,
            MarketStatus::Open => return err!(FulltimeError::MarketNotResolved),
        };
        require!(amount > 0, FulltimeError::NothingToClaim);
        // zero out so it cannot be withdrawn twice
        match market.status {
            MarketStatus::ResolvedYes => market.pool_yes = 0,
            MarketStatus::ResolvedNo => market.pool_no = 0,
            _ => market.seed_liquidity = 0,
        }

        transfer_out(ctx.accounts.market.clone(), &ctx.accounts.vault,
            &ctx.accounts.creator_token, &ctx.accounts.mint, &ctx.accounts.token_program, amount)
    }
}

fn transfer_in<'info>(
    from: &InterfaceAccount<'info, TokenAccount>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &Signer<'info>,
    token_program: &Interface<'info, TokenInterface>,
    amount: u64,
) -> Result<()> {
    token_interface::transfer_checked(
        CpiContext::new(
            token_program.key(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: vault.to_account_info(),
                authority: authority.to_account_info(),
            },
        ),
        amount,
        mint.decimals,
    )
}

fn transfer_out<'info>(
    market: Account<'info, Market>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    token_program: &Interface<'info, TokenInterface>,
    amount: u64,
) -> Result<()> {
    let creator = market.creator;
    let market_id_le = market.market_id.to_le_bytes();
    let seeds: &[&[u8]] = &[Market::SEED, creator.as_ref(), &market_id_le, &[market.bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: market.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )
}

#[derive(Accounts)]
#[instruction(args: CreateMarketArgs)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [Market::SEED, creator.key().as_ref(), &args.market_id.to_le_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = creator,
        seeds = [Market::VAULT_SEED, market.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = market,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint)]
    pub creator_token: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: pinned into market state; validated on every resolve
    pub oracle_program: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + Position::INIT_SPACE,
        seeds = [Position::SEED, market.key().as_ref(), buyer.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
    #[account(
        mut,
        seeds = [Market::VAULT_SEED, market.key().as_ref()],
        bump = market.vault_bump
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = market.mint)]
    pub buyer_token: InterfaceAccount<'info, TokenAccount>,
    #[account(address = market.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Resolve<'info> {
    pub keeper: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// CHECK: address enforced against market.oracle_program in handler
    pub oracle_program: UncheckedAccount<'info>,
    /// CHECK: PDA derivation enforced against bundle.ts in handler
    pub daily_scores_roots: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [Position::SEED, market.key().as_ref(), claimer.key().as_ref()],
        bump = position.bump,
        has_one = market,
        constraint = position.owner == claimer.key()
    )]
    pub position: Account<'info, Position>,
    #[account(
        mut,
        seeds = [Market::VAULT_SEED, market.key().as_ref()],
        bump = market.vault_bump
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = market.mint)]
    pub claimer_token: InterfaceAccount<'info, TokenAccount>,
    #[account(address = market.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct VoidMarket<'info> {
    pub caller: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct WithdrawLiquidity<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [Market::VAULT_SEED, market.key().as_ref()],
        bump = market.vault_bump
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = market.mint)]
    pub creator_token: InterfaceAccount<'info, TokenAccount>,
    #[account(address = market.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}
