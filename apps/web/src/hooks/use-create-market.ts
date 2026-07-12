"use client";

import * as anchor from "@coral-xyz/anchor";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFulltimeProgram } from "@/lib/anchor-client";
import { BASE, type PredicateFields } from "@/lib/statkeys";
import type { MarketDTO } from "@/lib/types";

// ---------------------------------------------------------------------------
// Pure helpers for the create-market modal — everything below up to
// `submitCreateMarket` is plain data-in/data-out, unit-tested in
// tests/create-market.test.ts per the pure-helper-only test convention.
// ---------------------------------------------------------------------------

// Program args fixed by the plan: resolvable 105min after kickoff (90min
// regulation + HT/stoppage buffer), voidable 48h after that, 10min finality
// delay. `startTimeMs` is TxLINE's 13-digit epoch-milliseconds StartTime —
// on-chain timestamps are unix seconds.
export const CREATE_FINALITY_DELAY_SECS = 600;

export function defaultTimes(startTimeMs: number): {
  resolveAfterTs: number;
  voidAfterTs: number;
} {
  const resolveAfterTs = Math.floor(startTimeMs / 1000) + 105 * 60;
  return { resolveAfterTs, voidAfterTs: resolveAfterTs + 48 * 3600 };
}

// The four non-custom presets, all full-match (period 0 → bare base keys)
// and all GreaterThan, so none can ever need a zero stat (no gold warning).
// Mirrors the seeder's slate shapes (packages/ingest/src/seed-markets.ts).
export type PresetId = "goals" | "corners" | "yellows" | "homeWin";

export function presetPredicate(preset: PresetId, threshold: number): PredicateFields {
  switch (preset) {
    case "goals":
      return { statKeyA: BASE.GOALS_T1, statKeyB: BASE.GOALS_T2, op: "Add", comparison: "GreaterThan", threshold };
    case "corners":
      return { statKeyA: BASE.CORNERS_T1, statKeyB: BASE.CORNERS_T2, op: "Add", comparison: "GreaterThan", threshold };
    case "yellows":
      return { statKeyA: BASE.YELLOWS_T1, statKeyB: BASE.YELLOWS_T2, op: "Add", comparison: "GreaterThan", threshold };
    case "homeWin":
      // Threshold is meaningless for a win market — always goals diff > 0.
      return { statKeyA: BASE.GOALS_T1, statKeyB: BASE.GOALS_T2, op: "Subtract", comparison: "GreaterThan", threshold: 0 };
  }
}

// String unions (MarketDTO/PredicateFields convention) → the `{ add: {} }`
// style enum objects anchor's borsh coder expects. statKeyB/op stay null for
// single-stat predicates (IDL `option<u32>` / `option<BinaryOp>`).
export function predicateToAnchorArgs(p: PredicateFields): {
  statKeyA: number;
  statKeyB: number | null;
  op: { add: Record<string, never> } | { subtract: Record<string, never> } | null;
  comparison:
    | { greaterThan: Record<string, never> }
    | { lessThan: Record<string, never> }
    | { equalTo: Record<string, never> };
  threshold: number;
} {
  return {
    statKeyA: p.statKeyA,
    statKeyB: p.statKeyB,
    op: p.op === null ? null : p.op === "Add" ? { add: {} } : { subtract: {} },
    comparison:
      p.comparison === "GreaterThan"
        ? { greaterThan: {} }
        : p.comparison === "LessThan"
          ? { lessThan: {} }
          : { equalTo: {} },
    threshold: p.threshold,
  };
}

// A fixture's markets must all share one stake mint for positions to be
// fungible in the same wallet flow — reuse the existing markets' mint when
// any exist; caller falls back to NEXT_PUBLIC_STAKE_MINT for a bare fixture.
export function mintForFixture(markets: MarketDTO[]): string | null {
  return markets.length > 0 ? markets[0].mint : null;
}

// Same 6-decimal parse discipline as trade-slip.tsx's parseAmount, except
// empty input is invalid here (a create must always seed liquidity) rather
// than 0.
const DECIMALS = 6;
const UNIT = 10n ** BigInt(DECIMALS);

export const MIN_SEED_LIQUIDITY = 10n * UNIT; // 10 tokens per the brief

export function parseTokenAmount(input: string): bigint | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "000000").slice(0, DECIMALS);
  return BigInt(whole || "0") * UNIT + BigInt(fracPadded);
}

// datetime-local <input> value ("YYYY-MM-DDTHH:MM", user's local timezone)
// ↔ unix seconds. `new Date()` on that exact shape parses as local time per
// spec, which is what a datetime-local input displays — the pair round-trips
// any minute-aligned timestamp.
export function tsToLocalInput(tsSecs: number): string {
  const d = new Date(tsSecs * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToTs(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

// ---------------------------------------------------------------------------
// mapCreateError — Task 12's error-map pattern (use-trade.ts mapBuyError)
// with create-market copy. Never a raw code alone.
// ---------------------------------------------------------------------------
type ErrLike = {
  message?: string;
  logs?: string[];
};

const FALLBACK_MSG_MAX = 120;

export function mapCreateError(err: unknown): string {
  const e = (err ?? {}) as ErrLike;
  const message = e.message ?? (typeof err === "string" ? err : String(err));
  const logs = Array.isArray(e.logs) ? e.logs.join(" ") : "";
  const haystack = `${message} ${logs}`;

  if (/user rejected|reject(ed)? the request|wallet.*reject/i.test(message)) {
    return "Cancelled in wallet";
  }
  if (/\b0x1\b/.test(haystack) || /insufficient funds/i.test(haystack)) {
    return "Market not created — not enough test USDC in wallet";
  }

  const short =
    message.length > FALLBACK_MSG_MAX ? `${message.slice(0, FALLBACK_MSG_MAX)}…` : message;
  return `Market not created — ${short}`;
}

// ---------------------------------------------------------------------------
// submitCreateMarket — builds and sends the exact create_market instruction
// the seeder sends (packages/ingest/src/seed-markets.ts is the source of
// truth for accounts + arg encoding; PDAs per Global Constraints). Plain
// async function, not a hook: the devnet verify script drives this same code
// path with the dev wallet, and the hook below wraps it for the browser.
// ---------------------------------------------------------------------------
export type CreateMarketParams = {
  marketId: bigint;
  fixtureId: number;
  predicate: PredicateFields;
  seedLiquidity: bigint;
  resolveAfterTs: number;
  voidAfterTs: number;
  mint: PublicKey;
  oracleProgram: PublicKey;
};

export async function submitCreateMarket(
  program: anchor.Program,
  creator: PublicKey,
  params: CreateMarketParams
): Promise<{ sig: string; marketPda: string }> {
  const marketIdBn = new anchor.BN(params.marketId.toString());
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), creator.toBuffer(), marketIdBn.toArrayLike(Buffer, "le", 8)],
    program.programId
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    program.programId
  );
  const creatorToken = getAssociatedTokenAddressSync(params.mint, creator);

  // Idempotent ATA create (same defensive pre-ix as use-trade.ts's buy):
  // a creator with no ATA then fails the seed transfer as a mapped
  // insufficient-funds error instead of a raw account-not-found.
  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    creator,
    creatorToken,
    creator,
    params.mint
  );

  const a = predicateToAnchorArgs(params.predicate);

  const sig = await program.methods
    .createMarket({
      marketId: marketIdBn,
      fixtureId: new anchor.BN(params.fixtureId),
      statKeyA: a.statKeyA,
      statKeyB: a.statKeyB,
      op: a.op,
      comparison: a.comparison,
      threshold: a.threshold,
      seedLiquidity: new anchor.BN(params.seedLiquidity.toString()),
      resolveAfterTs: new anchor.BN(params.resolveAfterTs),
      finalityDelaySecs: CREATE_FINALITY_DELAY_SECS,
      voidAfterTs: new anchor.BN(params.voidAfterTs),
    })
    .accountsPartial({
      creator,
      market,
      vault,
      creatorToken,
      mint: params.mint,
      oracleProgram: params.oracleProgram,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions([createAtaIx])
    .rpc();

  return { sig, marketPda: market.toBase58() };
}

// ---------------------------------------------------------------------------
// useCreateMarket — browser wrapper: resolves mint (fixture's existing
// markets' mint, else NEXT_PUBLIC_STAKE_MINT) + oracle program from env,
// mints a fresh market_id from the wall clock, submits, then nudges the
// ["markets"] cache.
// ---------------------------------------------------------------------------

// Statically referenced so Next can inline them client-side.
const ENV_STAKE_MINT = process.env.NEXT_PUBLIC_STAKE_MINT;
const ENV_ORACLE_PROGRAM = process.env.NEXT_PUBLIC_ORACLE_PROGRAM;

export type CreateMarketInput = {
  fixtureId: number;
  predicate: PredicateFields;
  seedLiquidity: bigint;
  resolveAfterTs: number;
  voidAfterTs: number;
  // From mintForFixture(markets) — null when the fixture has no markets yet.
  mintHint: string | null;
};

export function useCreateMarket() {
  const program = useFulltimeProgram();
  const wallet = useAnchorWallet();
  const queryClient = useQueryClient();

  const create = useCallback(
    async (input: CreateMarketInput): Promise<{ sig: string; marketPda: string }> => {
      if (!program || !wallet) {
        throw new Error("Connect a wallet to create a market");
      }

      const mintStr = input.mintHint ?? ENV_STAKE_MINT;
      if (!mintStr) {
        throw new Error(
          "NEXT_PUBLIC_STAKE_MINT is not set — run the seeder (packages/ingest/src/seed-markets.ts) and copy the printed mint into apps/web/.env.local"
        );
      }
      if (!ENV_ORACLE_PROGRAM) {
        throw new Error("NEXT_PUBLIC_ORACLE_PROGRAM is not set in apps/web/.env.local");
      }

      const result = await submitCreateMarket(program, wallet.publicKey, {
        marketId: BigInt(Date.now()),
        fixtureId: input.fixtureId,
        predicate: input.predicate,
        seedLiquidity: input.seedLiquidity,
        resolveAfterTs: input.resolveAfterTs,
        voidAfterTs: input.voidAfterTs,
        mint: new PublicKey(mintStr),
        oracleProgram: new PublicKey(ENV_ORACLE_PROGRAM),
      });

      // Mark ["markets"] stale per the plan, but never refetch: that cache
      // is SSE-fed (its queryFn is only a type-satisfying closure over the
      // RSC snapshot — see use-markets.ts), so an actual refetch would
      // REGRESS the cache to page-load data. The chain poller broadcasts the
      // new market within ~2s.
      queryClient.invalidateQueries({ queryKey: ["markets"], refetchType: "none" });

      return result;
    },
    [program, wallet, queryClient]
  );

  return { create };
}
