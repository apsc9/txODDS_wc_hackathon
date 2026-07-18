import "server-only";

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import idl from "../idl/fulltime.json";
import { predicateHuman, predicateMono } from "../lib/statkeys";
import { fixtureTeams } from "../lib/known-fixtures";
import type { MarketDTO } from "../lib/types";
import { getProgram, toMarketDTO } from "./chain";
import { hub } from "./feedhub";

// Matches apps/web/.env.local.example's NEXT_PUBLIC_ORACLE_PROGRAM /
// packages/ingest/src/config.ts's devnet oracle program id — same
// env-driven-with-fallback pattern as chain.ts's RPC_URL.
const ORACLE_PROGRAM =
  process.env.NEXT_PUBLIC_ORACLE_PROGRAM ?? "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";

// ---------------------------------------------------------------------------
// Raw Borsh-decoded ValidationBundle shape — field names verbatim from the
// IDL (snake_case), NOT the camelCased shape Anchor's account coder
// produces. `BorshInstructionCoder` (unlike the `Program`-wrapped coder)
// decodes instruction args using the IDL's field names as-is. This is the
// exact on-chain proof the `resolve` instruction consumed, byte for byte.
// ---------------------------------------------------------------------------
export type RawProofNode = { hash: number[]; is_right_sibling: boolean };

export type RawScoreStat = { key: number; value: number; period: number };

export type RawStatTerm = {
  stat_to_prove: RawScoreStat;
  event_stat_root: number[];
  stat_proof: RawProofNode[];
};

export type RawValidationBundle = {
  ts: anchor.BN;
  fixture_summary: {
    fixture_id: anchor.BN;
    update_stats: { update_count: number; min_timestamp: anchor.BN; max_timestamp: anchor.BN };
    events_sub_tree_root: number[];
  };
  fixture_proof: RawProofNode[];
  main_tree_proof: RawProofNode[];
  stat_a: RawStatTerm;
  stat_b: RawStatTerm | null;
};

type DecodedResolveIx = { name: "resolve"; bundle: RawValidationBundle };

// Built once at module scope — same reasoning as chain.ts's cached Program:
// constructing a coder per call is wasted IDL-layout work on a hot path
// (buildReceipt scans up to 50 signatures per request).
const ixCoder = new anchor.BorshInstructionCoder(idl as anchor.Idl);

// Exported per the brief for direct unit testing against a real captured
// resolve tx (tests/fixtures/resolve-tx.json) — decodes one instruction's
// raw data and returns null for anything that isn't a `resolve` call
// (wrong discriminator, garbage, or a different FullTime instruction).
export function decodeResolveIx(dataBase58: string): DecodedResolveIx | null {
  const decoded = ixCoder.decode(dataBase58, "base58");
  if (!decoded || decoded.name !== "resolve") return null;
  // BorshInstructionCoder.decode returns { name, data } where `data` is the
  // struct of the ix's named args — `resolve` has exactly one, `bundle`.
  const { bundle } = decoded.data as { bundle: RawValidationBundle };
  return { name: "resolve", bundle };
}

function hexOf(bytes: number[] | Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function statTermToDTO(term: RawScoreStat): { key: number; value: number; period: number } {
  return { key: term.key, value: term.value, period: term.period };
}

export type ReceiptDTO = {
  market: MarketDTO;
  predicate: { mono: string; human: string };
  status: MarketDTO["status"];
  resolveTx: string | null;
  bundle: {
    ts: number;
    statA: { key: number; value: number; period: number };
    statB?: { key: number; value: number; period: number };
    eventStatRoot: string;
    statProofHashes: string[];
    fixtureProofHashes: string[];
    mainTreeProofHashes: string[];
  } | null;
  rootsPda: string;
  epochDay: number;
  oracleProgram: string;
  voided: boolean;
};

// Derives the oracle program's `daily_scores_roots` PDA for the epoch day a
// proven packet ts falls on — mirrors smoke-devnet.ts's derivation exactly
// (u16 LE epoch-day seed), so this must stay in sync with that script and
// the oracle program's own PDA seeds if either ever changes.
function dailyScoresRootsPda(epochDay: number, oracleProgram: PublicKey): PublicKey {
  const epochDayBuf = Buffer.alloc(2);
  epochDayBuf.writeUInt16LE(epochDay, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), epochDayBuf],
    oracleProgram,
  );
  return pda;
}

// Finds the `resolve` instruction among a market's recent transactions and
// decodes its ValidationBundle. Returns null if none of the last `limit`
// signatures contain a (successful) resolve call — the normal case for
// Open/Voided markets, which never had one.
async function findResolveTx(
  program: anchor.Program,
  marketPda: PublicKey,
): Promise<{ sig: string; bundle: RawValidationBundle } | null> {
  const connection = program.provider.connection;
  const sigs = await connection.getSignaturesForAddress(marketPda, { limit: 50 });

  for (const sigInfo of sigs) {
    if (sigInfo.err) continue; // a failed resolve attempt never actually proved anything on-chain
    const tx = await connection.getTransaction(sigInfo.signature, {
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) continue;

    // `VersionedMessage` (legacy `Message` and `MessageV0` alike) exposes
    // both of these directly — no encoding-specific branching needed.
    const message = tx.transaction.message;
    const staticKeys = message.staticAccountKeys;
    const instructions = message.compiledInstructions;

    for (const ix of instructions) {
      const programId = staticKeys[ix.programIdIndex];
      if (!programId || !programId.equals(program.programId)) continue;

      const decoded = decodeResolveIx(anchor.utils.bytes.bs58.encode(Buffer.from(ix.data)));
      if (decoded) return { sig: sigInfo.signature, bundle: decoded.bundle };
    }
  }

  return null;
}

// buildReceipt — the Resolution Receipt page's sole data source. Reads the
// Market account fresh (any status), and — only for a resolved market —
// locates and decodes the real on-chain `resolve` transaction to surface
// the exact ValidationBundle that settled it. Voided/Open markets never had
// a resolve call, so `bundle`/`resolveTx` stay null and `rootsPda`/
// `epochDay` (which are only meaningful relative to a proven packet ts)
// fall back to "" / 0 — the receipt UI never renders those fields unless
// `bundle` is non-null, so the sentinel values are never displayed.
export async function buildReceipt(marketPda: string): Promise<ReceiptDTO> {
  const program = getProgram();
  const pubkey = new PublicKey(marketPda);

  const account = await (program.account as any).market.fetch(pubkey);
  const dto = toMarketDTO(marketPda, account);

  // Team names for predicateHuman (e.g. "Spain to win" instead of "Home to
  // win") — live hub entry first, then the static known-fixtures fallback,
  // since a resolved market's fixture has usually rolled off the live hub
  // cache by the time its receipt is viewed.
  const { t1, t2 } = fixtureTeams(hub.fixtures, dto.fixtureId);
  const predicate = {
    mono: predicateMono(dto),
    human: predicateHuman(dto, t1, t2),
  };

  const voided = dto.status === "Voided";
  const wasResolved = dto.status === "ResolvedYes" || dto.status === "ResolvedNo";

  let resolveTx: string | null = null;
  let bundle: ReceiptDTO["bundle"] = null;
  let rootsPda = "";
  let epochDay = 0;

  if (wasResolved) {
    const found = await findResolveTx(program, pubkey);
    if (found) {
      resolveTx = found.sig;
      const raw = found.bundle;
      epochDay = Math.floor(Number(raw.ts.toString()) / 86_400_000);
      rootsPda = dailyScoresRootsPda(epochDay, new PublicKey(ORACLE_PROGRAM)).toBase58();

      bundle = {
        ts: Number(raw.ts.toString()),
        statA: statTermToDTO(raw.stat_a.stat_to_prove),
        ...(raw.stat_b ? { statB: statTermToDTO(raw.stat_b.stat_to_prove) } : {}),
        eventStatRoot: hexOf(raw.stat_a.event_stat_root),
        statProofHashes: raw.stat_a.stat_proof.map((n) => hexOf(n.hash)),
        fixtureProofHashes: raw.fixture_proof.map((n) => hexOf(n.hash)),
        mainTreeProofHashes: raw.main_tree_proof.map((n) => hexOf(n.hash)),
      };
    }
  }

  return {
    market: dto,
    predicate,
    status: dto.status,
    resolveTx,
    bundle,
    rootsPda,
    epochDay,
    oracleProgram: ORACLE_PROGRAM,
    voided,
  };
}
