import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import fs from "node:fs";
import { decide, type AgentMarket, type Decision, type MarketRuntime } from "./engine.js";
import { appendDecision, readDecisions, rebuildExposure, type DecisionRecord } from "./log.js";
import { IDL_PATH, PROGRAM_ID, RPC_URL, loadAgentWallet, type AgentConfig } from "./config.js";

export type TradeDecision = Extract<Decision, { kind: "trade" }>;

// Skip reasons noisy at 5s cadence; only decisions a human wants in the
// demo log get written. "closed"/"caps" are one-shot state changes worth
// seeing; "small-edge"/"no-fair"/"not-open"/"cooldown" recur every tick.
const QUIET_SKIPS = new Set(["small-edge", "no-fair", "not-open", "cooldown"]);

export async function fetchOpenMarkets(
  apiBase: string,
  fixtureIds: number[] | null,
  fetchFn: typeof fetch = fetch
): Promise<AgentMarket[]> {
  let ids = fixtureIds;
  if (ids === null) {
    const res = await fetchFn(`${apiBase}/api/fixtures`);
    if (!res.ok) throw new Error(`GET /api/fixtures ${res.status}`);
    const body = (await res.json()) as { fixtures: Array<{ FixtureId: number }> };
    ids = body.fixtures.map((f) => f.FixtureId);
  }
  const out: AgentMarket[] = [];
  for (const id of ids) {
    const res = await fetchFn(`${apiBase}/api/markets?fixtureId=${id}`);
    if (!res.ok) throw new Error(`GET /api/markets?fixtureId=${id} ${res.status}`);
    const body = (await res.json()) as { markets: AgentMarket[] };
    out.push(...body.markets);
  }
  return out;
}

export function createProgram(): { program: anchor.Program; keypair: Keypair } {
  const keypair = loadAgentWallet();
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), {
    commitment: "confirmed",
  });
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
  return { program: new anchor.Program(idl, provider), keypair };
}

export type BuyDeps = { program: anchor.Program; keypair: Keypair };

// Mirrors apps/web/src/hooks/use-trade.ts buy() account construction
// (frozen Track 1 code — copied, not imported).
export async function executeBuy(deps: BuyDeps, m: AgentMarket, d: TradeDecision): Promise<string> {
  const { program, keypair } = deps;
  const buyer = keypair.publicKey;
  const marketPk = new PublicKey(m.pda);
  const mint = new PublicKey(m.mint);
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPk.toBuffer()],
    program.programId
  );
  const [position] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), marketPk.toBuffer(), buyer.toBuffer()],
    program.programId
  );
  const buyerToken = getAssociatedTokenAddressSync(mint, buyer);
  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(buyer, buyerToken, buyer, mint);
  const sideArg = d.side === "YES" ? { yes: {} } : { no: {} };

  return await (program.methods as any)
    .buy(sideArg, new BN(d.amountInUnits.toString()), new BN(d.minSharesOut.toString()))
    .accounts({
      buyer,
      market: marketPk,
      position,
      vault,
      buyerToken,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([createAtaIx])
    .rpc();
}

export type TraderDeps = {
  fetchMarkets: () => Promise<AgentMarket[]>;
  executeBuy: (m: AgentMarket, d: TradeDecision) => Promise<string>;
  now: () => number;
};

export type TraderState = {
  perMarket: Map<string, MarketRuntime>;
  globalSpentUnits: bigint;
};

export function makeTrader(cfg: AgentConfig, deps: Partial<TraderDeps> = {}) {
  // Lazy chain wiring: tests inject executeBuy/fetchMarkets, prod builds the
  // real Program once on first live trade.
  let chain: BuyDeps | null = null;
  const realExecuteBuy = async (m: AgentMarket, d: TradeDecision) => {
    chain ??= createProgram();
    return executeBuy(chain, m, d);
  };
  const d: TraderDeps = {
    fetchMarkets: deps.fetchMarkets ?? (() => fetchOpenMarkets(cfg.apiBase, cfg.fixtureIds)),
    executeBuy: deps.executeBuy ?? realExecuteBuy,
    now: deps.now ?? Date.now,
  };

  const prior = rebuildExposure(readDecisions(cfg.logPath));
  const state: TraderState = {
    perMarket: new Map(
      Array.from(prior.perMarket, ([pda, units]) => [pda, { exposureUnits: units, lastTradeMs: 0 }])
    ),
    globalSpentUnits: prior.globalUnits,
  };

  async function tick(): Promise<void> {
    const markets = await d.fetchMarkets();
    for (const m of markets) {
      const rt = state.perMarket.get(m.pda) ?? { exposureUnits: 0n, lastTradeMs: 0 };
      const nowMs = d.now();
      const decision = decide(m, rt, state.globalSpentUnits, nowMs, cfg.engine);

      if (decision.kind === "skip") {
        if (!QUIET_SKIPS.has(decision.reason)) {
          appendDecision(cfg.logPath, {
            ts: nowMs,
            fixtureId: m.fixtureId,
            marketPda: m.pda,
            kind: "skip",
            reason: decision.reason,
            edgePpm: decision.edgePpm,
          });
        }
        continue;
      }

      const base: DecisionRecord = {
        ts: nowMs,
        fixtureId: m.fixtureId,
        marketPda: m.pda,
        kind: "trade",
        fairPpm: m.fairPpm ?? undefined,
        poolPpm: m.yesPpm,
        edgePpm: decision.edgePpm,
        side: decision.side,
        amountInUnits: decision.amountInUnits.toString(),
        quotedShares: decision.quotedShares.toString(),
        minSharesOut: decision.minSharesOut.toString(),
      };

      if (!cfg.live) {
        appendDecision(cfg.logPath, { ...base, kind: "skip", reason: "dry-run" });
        console.log(
          `[trader] DRY-RUN would buy ${decision.side} ${decision.amountInUnits} on ${m.pda.slice(0, 8)} (edge ${decision.edgePpm})`
        );
        continue;
      }

      try {
        const tx = await d.executeBuy(m, decision);
        appendDecision(cfg.logPath, { ...base, tx });
        rt.exposureUnits += decision.amountInUnits;
        rt.lastTradeMs = nowMs;
        state.perMarket.set(m.pda, rt);
        state.globalSpentUnits += decision.amountInUnits;
        console.log(`[trader] BUY ${decision.side} ${decision.amountInUnits} ${m.pda.slice(0, 8)} tx ${tx}`);
      } catch (e: any) {
        appendDecision(cfg.logPath, { ...base, error: String(e?.message ?? e) });
        console.error(`[trader] buy FAILED ${m.pda.slice(0, 8)}: ${e?.message ?? e}`);
      }
    }
  }

  return { tick, state };
}
