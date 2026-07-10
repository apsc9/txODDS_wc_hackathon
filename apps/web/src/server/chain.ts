import "server-only";

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import idl from "../../../../target/idl/fulltime.json";
import { impliedProbPpm } from "../lib/fpmm";
import type { MarketDTO, PositionDTO } from "../lib/types";
import { hub } from "./feedhub";

const POLL_INTERVAL_MS = 2000;

// Matches apps/web/.env.local.example — falls back to the public devnet RPC
// so local dev works without an .env.local. The IDL's own `address` field
// (not an env var) is the source of truth for the program id, per Anchor
// 0.30+'s `new Program(idl, provider)` convention (see smoke-devnet.ts).
const RPC_URL = process.env.NEXT_PUBLIC_RPC ?? "https://api.devnet.solana.com";

declare global {
  // eslint-disable-next-line no-var
  var __fulltimeChainStarted: boolean | undefined;
}

// --- raw Anchor-decoded account shapes (camelCased by the IDL coder) -------

type RawEnum = Record<string, Record<string, never>>;

type RawMarketAccount = {
  creator: PublicKey;
  marketId: anchor.BN;
  fixtureId: anchor.BN;
  statKeyA: number;
  statKeyB: number | null;
  op: RawEnum | null;
  comparison: RawEnum;
  threshold: number;
  mint: PublicKey;
  oracleProgram: PublicKey;
  poolYes: anchor.BN;
  poolNo: anchor.BN;
  seedLiquidity: anchor.BN;
  resolveAfterTs: anchor.BN;
  finalityDelaySecs: number;
  voidAfterTs: anchor.BN;
  status: RawEnum;
  bump: number;
  vaultBump: number;
};

type RawPositionAccount = {
  owner: PublicKey;
  market: PublicKey;
  yesShares: anchor.BN;
  noShares: anchor.BN;
  costPaid: anchor.BN;
  claimed: boolean;
  bump: number;
};

// Anchor represents Rust enums as single-key objects, e.g. `{ greaterThan: {} }`
// for `Comparison::GreaterThan` — the key is the camelCase variant name.
// Capitalizing its first letter recovers the PascalCase union members used
// throughout the web app (matches the on-chain variant names verbatim).
function decodeEnum<T extends string>(raw: RawEnum): T {
  const key = Object.keys(raw)[0] ?? "";
  return (key.charAt(0).toUpperCase() + key.slice(1)) as T;
}

export function toMarketDTO(pda: string, acct: RawMarketAccount): MarketDTO {
  const poolYes = BigInt(acct.poolYes.toString());
  const poolNo = BigInt(acct.poolNo.toString());

  return {
    pda,
    creator: acct.creator.toString(),
    marketId: acct.marketId.toString(),
    fixtureId: acct.fixtureId.toNumber(),
    statKeyA: acct.statKeyA,
    statKeyB: acct.statKeyB,
    op: acct.op ? decodeEnum<"Add" | "Subtract">(acct.op) : null,
    comparison: decodeEnum<"GreaterThan" | "LessThan" | "EqualTo">(acct.comparison),
    threshold: acct.threshold,
    mint: acct.mint.toString(),
    poolYes: poolYes.toString(),
    poolNo: poolNo.toString(),
    seedLiquidity: acct.seedLiquidity.toString(),
    resolveAfterTs: acct.resolveAfterTs.toNumber(),
    finalityDelaySecs: acct.finalityDelaySecs,
    voidAfterTs: acct.voidAfterTs.toNumber(),
    status: decodeEnum<"Open" | "ResolvedYes" | "ResolvedNo" | "Voided">(acct.status),
    yesPpm: impliedProbPpm(poolYes, poolNo) ?? 0,
  };
}

function toPositionDTO(pda: string, acct: RawPositionAccount): PositionDTO {
  return {
    pda,
    market: acct.market.toString(),
    yesShares: acct.yesShares.toString(),
    noShares: acct.noShares.toString(),
    costPaid: acct.costPaid.toString(),
    claimed: acct.claimed,
  };
}

// Read-only client: a freshly generated `Keypair` never signs anything here
// (only `.all()` / `.fetch()` account reads are made), so no real wallet or
// secret is needed. Built lazily and cached so both the poller and
// `fetchPositions` share one connection instead of dialing RPC per call.
let cachedProgram: anchor.Program | null = null;
function getProgram(): anchor.Program {
  if (!cachedProgram) {
    const connection = new Connection(RPC_URL, "confirmed");
    const wallet = new anchor.Wallet(Keypair.generate());
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
    cachedProgram = new anchor.Program(idl as anchor.Idl, provider);
  }
  return cachedProgram;
}

async function poll(program: anchor.Program): Promise<void> {
  const rows = await (program.account as any).market.all();
  let changed = false;

  for (const { publicKey, account } of rows as Array<{ publicKey: PublicKey; account: RawMarketAccount }>) {
    const pda = publicKey.toBase58();
    const dto = toMarketDTO(pda, account);

    const prev = hub.marketCache.get(pda);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(dto)) {
      hub.marketCache.set(pda, dto);
      changed = true;
    }

    if (dto.status === "Open") {
      hub.pushPrice(pda, {
        ts: Date.now(),
        poolPpm: dto.yesPpm,
        fairPpm: hub.fairPpmFor(dto),
      });
    }
  }

  if (changed) hub.emitMarketsChanged();
}

// Exported for tests: runs `runOnce` and only schedules the next tick once
// the current one has settled (resolved *or* rejected) — a recursive
// setTimeout rather than setInterval. This guarantees ticks never overlap:
// `program.account.market.all()` is a getProgramAccounts call that routinely
// takes >2s on the public devnet RPC, and overlapping polls would duplicate
// hub.pushPrice entries (chart jitter), pile up RPC load exactly when the
// RPC is already struggling, and race on hub.marketCache.set (a slower
// earlier response could clobber a newer one). Scheduling from settle-time
// also means cadence naturally backs off when the RPC is slow, instead of
// firing on a fixed wall-clock grid regardless of how long the last poll
// took. The .catch keeps outage-survival behavior: a failed poll still
// reschedules rather than killing the loop.
export function scheduleChainPolling(
  runOnce: () => Promise<void>,
  intervalMs: number = POLL_INTERVAL_MS,
): void {
  const tick = () => {
    runOnce()
      .catch((err) => {
        console.error("chain: poll failed", err);
      })
      .finally(() => {
        setTimeout(tick, intervalMs);
      });
  };

  tick();
}

export function startChainPoller(): void {
  if (globalThis.__fulltimeChainStarted) return;
  globalThis.__fulltimeChainStarted = true;

  const program = getProgram();
  scheduleChainPolling(() => poll(program));
}

export async function fetchPositions(owner: string): Promise<PositionDTO[]> {
  const program = getProgram();
  const rows = await (program.account as any).position.all([
    { memcmp: { offset: 8, bytes: owner } },
  ]);

  return (rows as Array<{ publicKey: PublicKey; account: RawPositionAccount }>).map(
    ({ publicKey, account }) => toPositionDTO(publicKey.toBase58(), account),
  );
}
