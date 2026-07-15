import { sharesOut } from "./fpmm.js";

// Subset of the web app's MarketDTO the agent consumes (apps/web/src/lib/
// types.ts is the canonical shape; this is a hand-kept structural subset,
// same tradeoff feedhub.ts takes for its own local Pick).
export type AgentMarket = {
  pda: string;
  fixtureId: number;
  mint: string;
  poolYes: string; // u64 decimal string
  poolNo: string; // u64 decimal string
  resolveAfterTs: number; // unix seconds
  status: "Open" | "ResolvedYes" | "ResolvedNo" | "Voided";
  yesPpm: number;
  fairPpm: number | null;
};

export type MarketRuntime = { exposureUnits: bigint; lastTradeMs: number };

export type EngineConfig = {
  edgeThresholdPpm: number;
  fullSizeEdgePpm: number; // edge at (or past) which a trade uses maxPerTradeUnits
  maxPerTradeUnits: bigint;
  maxPerMarketUnits: bigint;
  globalCapUnits: bigint;
  minTradeUnits: bigint;
  cooldownMs: number;
  closeBufferSecs: number; // mirror of on-chain TradingClosed gate
  slippagePpm: number;
};

export const DEFAULT_CONFIG: EngineConfig = {
  edgeThresholdPpm: 50_000, // 5 pts
  fullSizeEdgePpm: 200_000, // 20 pts
  maxPerTradeUnits: 5_000_000n, // 5 USDC
  maxPerMarketUnits: 20_000_000n, // 20 USDC
  globalCapUnits: 100_000_000n, // 100 USDC
  minTradeUnits: 1_000_000n, // 1 USDC
  cooldownMs: 60_000,
  closeBufferSecs: 60,
  slippagePpm: 20_000, // 2%
};

export type SkipReason =
  | "not-open"
  | "no-fair"
  | "closed"
  | "small-edge"
  | "cooldown"
  | "caps"
  | "no-quote"
  | "dry-run";

export type Decision =
  | {
      kind: "trade";
      side: "YES" | "NO";
      amountInUnits: bigint;
      quotedShares: bigint;
      minSharesOut: bigint;
      edgePpm: number;
    }
  | { kind: "skip"; reason: SkipReason; edgePpm: number | null };

const bmin = (a: bigint, b: bigint) => (a < b ? a : b);

export function decide(
  m: AgentMarket,
  rt: MarketRuntime,
  globalSpentUnits: bigint,
  nowMs: number,
  cfg: EngineConfig
): Decision {
  if (m.status !== "Open") return { kind: "skip", reason: "not-open", edgePpm: null };
  if (m.fairPpm === null) return { kind: "skip", reason: "no-fair", edgePpm: null };

  const edgePpm = m.fairPpm - m.yesPpm;

  if (nowMs / 1000 >= m.resolveAfterTs - cfg.closeBufferSecs) {
    return { kind: "skip", reason: "closed", edgePpm };
  }
  if (Math.abs(edgePpm) <= cfg.edgeThresholdPpm) {
    return { kind: "skip", reason: "small-edge", edgePpm };
  }
  if (nowMs - rt.lastTradeMs < cfg.cooldownMs) {
    return { kind: "skip", reason: "cooldown", edgePpm };
  }

  const remainingMarket = cfg.maxPerMarketUnits - rt.exposureUnits;
  const remainingGlobal = cfg.globalCapUnits - globalSpentUnits;
  const budget = bmin(remainingMarket, remainingGlobal);
  if (budget < cfg.minTradeUnits) return { kind: "skip", reason: "caps", edgePpm };

  // Proportional sizing: linear in |edge| up to the full-size knee, floored
  // at minTradeUnits, clamped by remaining budget.
  const clampedEdge = Math.min(Math.abs(edgePpm), cfg.fullSizeEdgePpm);
  const proportional = (cfg.maxPerTradeUnits * BigInt(clampedEdge)) / BigInt(cfg.fullSizeEdgePpm);
  const amountInUnits = bmin(
    budget,
    proportional < cfg.minTradeUnits ? cfg.minTradeUnits : proportional
  );

  const side: "YES" | "NO" = edgePpm > 0 ? "YES" : "NO";
  const poolYes = BigInt(m.poolYes);
  const poolNo = BigInt(m.poolNo);
  const poolThis = side === "YES" ? poolYes : poolNo;
  const poolOther = side === "YES" ? poolNo : poolYes;
  const quotedShares = sharesOut(poolThis, poolOther, amountInUnits);
  if (quotedShares === null || quotedShares <= 0n) {
    return { kind: "skip", reason: "no-quote", edgePpm };
  }
  const minSharesOut = (quotedShares * BigInt(1_000_000 - cfg.slippagePpm)) / 1_000_000n;

  return { kind: "trade", side, amountInUnits, quotedShares, minSharesOut, edgePpm };
}
