import type { PredicateFields } from "./statkeys";

// u64 account fields are carried as decimal strings (not `number`) since
// pool/liquidity amounts can exceed Number.MAX_SAFE_INTEGER — JSON-safe and
// lossless. i64 timestamp fields (resolveAfterTs/voidAfterTs) and fixtureId
// stay `number`: they're unix seconds / TxLINE fixture ids, both always well
// inside the safe-integer range in practice.
export type MarketDTO = PredicateFields & {
  pda: string;
  creator: string;
  marketId: string;
  fixtureId: number;
  mint: string;
  poolYes: string;
  poolNo: string;
  seedLiquidity: string;
  resolveAfterTs: number;
  finalityDelaySecs: number;
  voidAfterTs: number;
  status: "Open" | "ResolvedYes" | "ResolvedNo" | "Voided";
  yesPpm: number;
};

export type PositionDTO = {
  pda: string;
  market: string;
  yesShares: string;
  noShares: string;
  costPaid: string;
  claimed: boolean;
};
