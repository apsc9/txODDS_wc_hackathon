import "server-only";

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

// The tracked in-repo IDL copy (src/idl/fulltime.json) — NOT
// `target/idl/fulltime.json`: `target/` is build output and untracked, so a
// fresh clone (judges!) wouldn't compile against it. The two are kept
// byte-identical by `anchor build`; src/lib/anchor-client.ts and
// src/server/receipt.ts import this same copy.
import idl from "../idl/fulltime.json";
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
    // Consensus fair price is only ever known at poll time (it depends on
    // `hub.consensus`, not the on-chain account) — `poll()` below fills this
    // in for Open markets right after calling this function. Defaulting to
    // null here keeps toMarketDTO a pure decode of the account.
    fairPpm: null,
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
// Exported so other server-only modules (server/receipt.ts) reuse the same
// cached instance instead of constructing their own Keypair+Program per
// call — the footgun documented in the ledger for this exact function.
let cachedProgram: anchor.Program | null = null;
export function getProgram(): anchor.Program {
  if (!cachedProgram) {
    const connection = new Connection(RPC_URL, "confirmed");
    const wallet = new anchor.Wallet(Keypair.generate());
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
    cachedProgram = new anchor.Program(idl as anchor.Idl, provider);
  }
  return cachedProgram;
}

// Exported for tests (chain.test.ts drives one tick with a stubbed program):
// pins the fairPpm wiring below — cached DTO and history point both carry
// the consensus fair — which no amount of toMarketDTO/fairPpmFor unit
// coverage would catch if this glue layer were dropped.
export async function poll(program: anchor.Program): Promise<void> {
  const rows = await (program.account as any).market.all();
  let changed = false;

  for (const { publicKey, account } of rows as Array<{ publicKey: PublicKey; account: RawMarketAccount }>) {
    const pda = publicKey.toBase58();
    const dto = toMarketDTO(pda, account);

    // Compute consensus fair once per market per tick (fairPpmFor does a
    // couple of Map lookups, not free) and reuse it for both the cached DTO
    // (what the UI reads) and this tick's history point, rather than calling
    // it twice for the same market.
    if (dto.status === "Open") {
      dto.fairPpm = hub.fairPpmFor(dto);
    }

    const prev = hub.marketCache.get(pda);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(dto)) {
      hub.marketCache.set(pda, dto);
      changed = true;
    }

    if (dto.status === "Open") {
      hub.pushPrice(pda, {
        ts: Date.now(),
        poolPpm: dto.yesPpm,
        fairPpm: dto.fairPpm,
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

// Flag is set only *after* `getProgram()` returns successfully — it
// constructs the Anchor `Program` client and can throw synchronously (seen
// live as "Wallet is not a constructor"). Setting the flag first would make
// a throwing attempt permanently "started" (per the module-scope once-guard
// contract other callers rely on), so every later call would short-circuit
// as a no-op instead of retrying. Once `getProgram()` succeeds, the flag
// goes up before scheduling — matching the idempotency the comment on the
// `declare global` above promises for the success path.
export function startChainPoller(): void {
  if (globalThis.__fulltimeChainStarted) return;

  const program = getProgram();
  globalThis.__fulltimeChainStarted = true;
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
