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

// Client-safe mirrors of server/txline.ts's `Fixture` and server/feedhub.ts's
// `LiveScore` / `PricePoint`. Those modules both start with `import
// "server-only"` (feedhub.ts pulls it in transitively via txline.ts), so
// nothing that runs in the browser — notably the SSE hook in
// src/hooks/use-stream.ts, which needs exactly these three shapes to type
// the payloads /api/stream pushes — can import from them directly. Kept
// structurally identical to the server originals by hand (no compiler
// enforcement linking the two copies); same tradeoff feedhub.ts already
// accepts for its own local `MarketDTO` Pick of this file's canonical type.
export type Fixture = {
  FixtureId: number;
  StartTime: number;
  Participant1: string;
  Participant2: string;
  Participant1IsHome: boolean;
  Competition: string;
};

export type LiveScore = {
  fixtureId: number;
  gameState: string | null;
  clockSeconds: number | null;
  stats: Record<string, number>;
  seq: number;
  ts: number;
  recvTs: number;
};

export type PricePoint = {
  ts: number;
  poolPpm: number;
  fairPpm: number | null;
};
