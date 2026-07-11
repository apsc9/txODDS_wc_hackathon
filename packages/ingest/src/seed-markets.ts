/**
 * Idempotent devnet market seeder.
 *
 * Ensures a persistent test stake mint (`.keys/stake-mint.json`, created once
 * and reused thereafter — unlike smoke-devnet.ts's throwaway mint), funds the
 * wallet's ATA, then creates a fixed slate of FullTime markets for every
 * upcoming/live TxLINE fixture: total-goals over 1.5/2.5/3.5, corners over
 * 8.5, yellows over 3.5, and home win.
 *
 * `market_id = fixtureId * 100 + slateIndex` is fully deterministic, so
 * re-running this script is a no-op: each market's PDA already exists on
 * chain and is skipped rather than recreated.
 *
 * Usage: npx tsx src/seed-markets.ts devnet
 */
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, Connection } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import fs from "node:fs";
import { CONFIG, type Network } from "./config.js";
import { authenticate, apiClient, loadWallet } from "./auth.js";

const network: Network = "devnet";
const cfg = CONFIG[network];
const ORACLE_PROGRAM = new PublicKey(cfg.programId);

const STAKE_MINT_PATH = new URL("../../../.keys/stake-mint.json", import.meta.url);
const KEYS_DIR = new URL("../../../.keys/", import.meta.url);

// Mirrors apps/web/src/app/api/fixtures/route.ts's window: a small look-back
// catches fixtures already in play ("live ones" per the task brief — this
// feed's GameState string isn't a trustworthy live/finished signal, see that
// file's comment), and a 72h look-ahead catches upcoming ones.
const WINDOW_BEFORE_MS = 6 * 60 * 60 * 1000;
const WINDOW_AFTER_MS = 72 * 60 * 60 * 1000;

const SEED_LIQUIDITY = new BN(50_000_000); // 50 tokens @ 6 decimals
const FINALITY_DELAY_SECS = 600;
const RESOLVE_OFFSET_SECS = 105 * 60; // kickoff + 90min regulation + HT/stoppage buffer
const VOID_OFFSET_SECS = 48 * 60 * 60;

const MINT_DECIMALS = 6;
const ATA_TOP_UP_FLOOR = 100_000_000n; // 100 tokens
const ATA_TOP_UP_TARGET = 1_000_000_000n; // 1,000 tokens

const GREATER_THAN = { greaterThan: {} };

type Slate = {
  label: string;
  statKeyA: number;
  statKeyB: number;
  op: { add: {} } | { subtract: {} };
  threshold: number;
};

// Order fixes each slate's index (used in market_id below) — stable across
// runs, which is what makes the PDA-existence check double as idempotency.
const SLATE: Slate[] = [
  { label: "goals o1.5", statKeyA: 1, statKeyB: 2, op: { add: {} }, threshold: 1 },
  { label: "goals o2.5", statKeyA: 1, statKeyB: 2, op: { add: {} }, threshold: 2 },
  { label: "goals o3.5", statKeyA: 1, statKeyB: 2, op: { add: {} }, threshold: 3 },
  { label: "corners o8.5", statKeyA: 7, statKeyB: 8, op: { add: {} }, threshold: 8 },
  { label: "yellows o3.5", statKeyA: 3, statKeyB: 4, op: { add: {} }, threshold: 3 },
  { label: "home win", statKeyA: 1, statKeyB: 2, op: { subtract: {} }, threshold: 0 },
];

type Fixture = {
  FixtureId: number;
  StartTime: number;
  Participant1: string;
  Participant2: string;
};

async function ensureStakeMint(connection: Connection, keypair: anchor.web3.Keypair): Promise<PublicKey> {
  if (fs.existsSync(STAKE_MINT_PATH)) {
    const saved = JSON.parse(fs.readFileSync(STAKE_MINT_PATH, "utf8"));
    console.log(`[seed] stake mint (reused): ${saved.mint}`);
    return new PublicKey(saved.mint);
  }
  const mint = await createMint(connection, keypair, keypair.publicKey, null, MINT_DECIMALS);
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  fs.writeFileSync(
    STAKE_MINT_PATH,
    JSON.stringify({ mint: mint.toBase58(), createdAt: new Date().toISOString() }, null, 2),
  );
  console.log(`[seed] stake mint (created): ${mint.toBase58()}`);
  return mint;
}

async function ensureFundedAta(
  connection: Connection,
  keypair: anchor.web3.Keypair,
  mint: PublicKey,
): Promise<PublicKey> {
  const ata = await getOrCreateAssociatedTokenAccount(connection, keypair, mint, keypair.publicKey);
  if (ata.amount < ATA_TOP_UP_FLOOR) {
    const topUp = ATA_TOP_UP_TARGET - ata.amount;
    await mintTo(connection, keypair, mint, ata.address, keypair, topUp);
    console.log(`[seed] topped up creator ATA by ${topUp} base units (now ${ATA_TOP_UP_TARGET})`);
  } else {
    console.log(`[seed] creator ATA balance ${ata.amount} (no top-up needed)`);
  }
  return ata.address;
}

async function main() {
  const networkArg = process.argv[2];
  if (networkArg && networkArg !== "devnet") {
    throw new Error(`seed-markets.ts only supports devnet, got "${networkArg}"`);
  }

  const keypair = loadWallet();
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), {
    commitment: "confirmed",
  });
  const idl = JSON.parse(
    fs.readFileSync(new URL("../../../target/idl/fulltime.json", import.meta.url), "utf8"),
  );
  const program = new anchor.Program(idl, provider);
  console.log(`[seed] fulltime program: ${program.programId.toBase58()}`);
  console.log(`[seed] wallet: ${keypair.publicKey.toBase58()}`);

  const mint = await ensureStakeMint(connection, keypair);
  const creatorToken = await ensureFundedAta(connection, keypair, mint);

  const creds = await authenticate(network);
  const api = apiClient(network, creds);
  const { data: fixtures } = await api.get<Fixture[]>("/api/fixtures/snapshot");

  const now = Date.now();
  const lo = now - WINDOW_BEFORE_MS;
  const hi = now + WINDOW_AFTER_MS;
  const targets = fixtures.filter((f) => f.StartTime >= lo && f.StartTime <= hi);
  console.log(
    `[seed] ${targets.length}/${fixtures.length} fixtures in window (${new Date(lo).toISOString()} .. ${new Date(hi).toISOString()})`,
  );

  let created = 0;
  let skipped = 0;

  for (const fixture of targets) {
    const resolveAfterTs = Math.floor(fixture.StartTime / 1000) + RESOLVE_OFFSET_SECS;
    const voidAfterTs = resolveAfterTs + VOID_OFFSET_SECS;

    for (let slateIndex = 0; slateIndex < SLATE.length; slateIndex++) {
      const slate = SLATE[slateIndex];
      const marketId = BigInt(fixture.FixtureId) * 100n + BigInt(slateIndex);
      const marketIdBn = new BN(marketId.toString());

      const [market] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), keypair.publicKey.toBuffer(), marketIdBn.toArrayLike(Buffer, "le", 8)],
        program.programId,
      );
      const [vault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), market.toBuffer()],
        program.programId,
      );

      const existing = await connection.getAccountInfo(market);
      if (existing) {
        skipped++;
        console.log(
          `[seed] skip fixture ${fixture.FixtureId} (${fixture.Participant1} vs ${fixture.Participant2}) ${slate.label}: market ${market.toBase58()} already exists`,
        );
        continue;
      }

      try {
        const sig = await program.methods
          .createMarket({
            marketId: marketIdBn,
            fixtureId: new BN(fixture.FixtureId),
            statKeyA: slate.statKeyA,
            statKeyB: slate.statKeyB,
            op: slate.op,
            comparison: GREATER_THAN,
            threshold: slate.threshold,
            seedLiquidity: SEED_LIQUIDITY,
            resolveAfterTs: new BN(resolveAfterTs),
            finalityDelaySecs: FINALITY_DELAY_SECS,
            voidAfterTs: new BN(voidAfterTs),
          })
          .accountsPartial({
            creator: keypair.publicKey,
            market,
            vault,
            creatorToken,
            mint,
            oracleProgram: ORACLE_PROGRAM,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        created++;
        console.log(
          `[seed] created fixture ${fixture.FixtureId} (${fixture.Participant1} vs ${fixture.Participant2}) ${slate.label} market_id=${marketId} market=${market.toBase58()} tx=${sig}`,
        );
      } catch (err: any) {
        console.error(
          `[seed] FAILED fixture ${fixture.FixtureId} ${slate.label} market_id=${marketId}:`,
          err.message ?? err,
        );
        if (err.logs) console.error(err.logs.slice(-15).join("\n"));
        throw err;
      }
    }
  }

  console.log(`[seed] created ${created} markets, skipped ${skipped} existing`);
}

main().catch((e) => {
  console.error("[seed] FAILED:", e.message ?? e);
  process.exit(1);
});
