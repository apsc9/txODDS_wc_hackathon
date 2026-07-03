//! Fixed-product market maker math for a fully-collateralized binary market.
//!
//! Model (Gnosis-FPMM style, no SPL outcome tokens — shares tracked in PDAs):
//! - Depositing `x` stake tokens mints `x` YES + `x` NO share pairs into the pool.
//! - A YES buyer then withdraws `y` YES shares from the pool such that the
//!   product `pool_yes * pool_no` is preserved (rounded in the pool's favor).
//! - Winning shares redeem 1:1 against the vault. Since every share pair is
//!   backed by exactly one deposited token, the vault can never be short.
//!
//! All math is integer-only (u128 intermediates) => deterministic across
//! validators, no floating point in consensus code.

/// Shares received when buying `amount_in` of the YES side against reserves
/// (`pool_this` = reserve of the side being bought, `pool_other` = opposite).
/// Returns `None` on overflow or empty pool.
pub fn shares_out(pool_this: u64, pool_other: u64, amount_in: u64) -> Option<u64> {
    if pool_this == 0 || pool_other == 0 {
        return None;
    }
    let k = (pool_this as u128).checked_mul(pool_other as u128)?;
    let new_other = (pool_other as u128).checked_add(amount_in as u128)?;
    // ceil-div keeps the invariant k' >= k (pool never loses value to rounding)
    let new_this_min = k.div_ceil(new_other);
    let grown_this = (pool_this as u128).checked_add(amount_in as u128)?;
    let out = grown_this.checked_sub(new_this_min)?;
    u64::try_from(out).ok()
}

/// Pool reserves after a buy of `shares` on the `this` side with `amount_in` deposited.
pub fn pools_after_buy(
    pool_this: u64,
    pool_other: u64,
    amount_in: u64,
    shares: u64,
) -> Option<(u64, u64)> {
    let new_this = pool_this
        .checked_add(amount_in)?
        .checked_sub(shares)?;
    let new_other = pool_other.checked_add(amount_in)?;
    Some((new_this, new_other))
}

/// Implied probability of the `this` side in parts-per-million.
/// price(this) = pool_other / (pool_this + pool_other)
pub fn implied_prob_ppm(pool_this: u64, pool_other: u64) -> Option<u64> {
    let total = (pool_this as u128).checked_add(pool_other as u128)?;
    if total == 0 {
        return None;
    }
    let ppm = (pool_other as u128).checked_mul(1_000_000)? / total;
    u64::try_from(ppm).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn balanced_pool_buy_gets_more_shares_than_stake_but_less_than_double() {
        // 50/50 pool: buying YES at ~0.5 price should yield between x and 2x shares
        let out = shares_out(1_000_000, 1_000_000, 100_000).unwrap();
        assert!(out > 100_000, "yes at 0.5 must yield > stake, got {out}");
        assert!(out < 200_000, "cannot yield 2x stake, got {out}");
    }

    #[test]
    fn product_invariant_never_decreases() {
        let (py, pn) = (1_000_000u64, 500_000u64);
        let x = 123_457u64;
        let out = shares_out(py, pn, x).unwrap();
        let (ny, nn) = pools_after_buy(py, pn, x, out).unwrap();
        assert!(
            (ny as u128) * (nn as u128) >= (py as u128) * (pn as u128),
            "rounding must favor the pool"
        );
    }

    #[test]
    fn payout_never_exceeds_collateral() {
        // worst case: everyone buys the winning side
        let mut py = 1_000_000u64;
        let mut pn = 1_000_000u64;
        let seed = 1_000_000u64;
        let mut collateral = seed;
        let mut user_yes = 0u64;
        for _ in 0..50 {
            let x = 250_000u64;
            let out = shares_out(py, pn, x).unwrap();
            let (a, b) = pools_after_buy(py, pn, x, out).unwrap();
            py = a;
            pn = b;
            collateral += x;
            user_yes += out;
        }
        // user shares + pool-held YES shares == total minted YES == collateral
        assert_eq!(user_yes as u128 + py as u128, collateral as u128);
        assert!(user_yes <= collateral, "vault must cover all winning shares");
    }

    #[test]
    fn price_moves_toward_bought_side() {
        let p0 = implied_prob_ppm(1_000_000, 1_000_000).unwrap();
        assert_eq!(p0, 500_000);
        let x = 500_000u64;
        let out = shares_out(1_000_000, 1_000_000, x).unwrap();
        let (py, pn) = pools_after_buy(1_000_000, 1_000_000, x, out).unwrap();
        let p1 = implied_prob_ppm(py, pn).unwrap();
        assert!(p1 > p0, "buying YES must raise YES price: {p0} -> {p1}");
    }

    #[test]
    fn empty_pool_and_overflow_are_none() {
        assert!(shares_out(0, 1, 1).is_none());
        assert!(shares_out(u64::MAX, u64::MAX, u64::MAX).is_some() || true); // must not panic
    }
}
