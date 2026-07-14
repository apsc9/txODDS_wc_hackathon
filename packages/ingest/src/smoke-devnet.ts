/**
 * Devnet end-to-end smoke test for the deployed FullTime program.
 *
 * Proves the full loop against live infrastructure — no mocks:
 *   1. fetch a fresh stat-validation proof from TxLINE devnet API
 *   2. create a test mint + market on that fixture
 *   3. buy YES shares
 *   4. resolve via CPI into the real on-chain TxLINE oracle
 *   5. claim winnings + withdraw creator liquidity, vault must drain to 0
 *
 * Usage: npx tsx src/smoke-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, Connection, ComputeBudgetProgram } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import fs from "node:fs";
import { CONFIG } from "./config.js";
import { authenticate, apiClient, loadWallet } from "./auth.js";

const network = "devnet" as const;
const cfg = CONFIG[network];
const ORACLE_PROGRAM = new PublicKey(cfg.programId);

function toBytes32(value: string | number[] | Uint8Array): number[] {
  const bytes = Array.isArray(value)
    ? Uint8Array.from(value)
    : value instanceof Uint8Array
      ? value
      : value.startsWith("0x")
        ? Buffer.from(value.slice(2), "hex")
        : Buffer.from(value, "base64");
  if (bytes.length !== 32) throw new Error(`Expected 32 bytes, got ${bytes.length}`);
  return Array.from(bytes);
}

const toProofNodes = (nodes: Array<{ hash: string; isRightSibling: boolean }>) =>
  nodes.map((n) => ({ hash: toBytes32(n.hash), isRightSibling: n.isRightSibling }));

// Trading closes at resolve_after_ts (TradingClosed gate), and resolve needs
// a packet with ts >= resolve_after_ts — so the smoke market's resolve window
// must open in the near FUTURE: create + buy inside it, then wait for the
// feed to produce a provable score update after the window opens.
const RESOLVE_WINDOW_SECS = 30;

// Pick a fixture that is currently producing provable updates: newest update
// in the recent buckets whose statKey=1 value is already nonzero (stats are
// cumulative, so later updates stay provable).
async function pickActiveFixture(api: ReturnType<typeof apiClient>): Promise<number> {
  const now = Date.now();
  for (let back = 0; back < 12 * 24 * 14; back++) {
    const t = new Date(now - back * 300_000);
    const epochDay = Math.floor(t.getTime() / 86_400_000);
    const res = await api.get(
      `/api/scores/updates/${epochDay}/${t.getUTCHours()}/${Math.floor(t.getUTCMinutes() / 5)}`,
      { validateStatus: () => true },
    );
    if (res.status !== 200 || !Array.isArray(res.data) || res.data.length === 0) continue;
    for (const upd of [...res.data].reverse().slice(0, 8)) {
      const fixtureId = upd.fixtureId ?? upd.FixtureId;
      const seq = upd.seq ?? upd.Seq;
      const { data, status } = await api.get("/api/scores/stat-validation", {
        params: { fixtureId, seq, statKey: 1 },
        validateStatus: () => true,
      });
      if (status === 200 && data?.statToProve?.value > 0) {
        console.log(`[smoke] active fixture: ${fixtureId} (statKey1=${data.statToProve.value}, ${back * 5}min ago)`);
        return fixtureId;
      }
    }
  }
  throw new Error("no fixture with provable updates found");
}

async function scanForProof(api: ReturnType<typeof apiClient>, minTsMs: number, fixtureId?: number) {
  const now = Date.now();
  // scan buckets from minTs forward to now (updates are bucketed per 5min)
  for (let t = minTsMs - 300_000; t <= now + 300_000; t += 300_000) {
    const d = new Date(t);
    const epochDay = Math.floor(t / 86_400_000);
    const res = await api.get(
      `/api/scores/updates/${epochDay}/${d.getUTCHours()}/${Math.floor(d.getUTCMinutes() / 5)}`,
      { validateStatus: () => true },
    );
    if (res.status !== 200 || !Array.isArray(res.data) || res.data.length === 0) continue;
    for (const upd of [...res.data].reverse().slice(0, 8)) {
      const fid = upd.fixtureId ?? upd.FixtureId;
      if (fixtureId !== undefined && fid !== fixtureId) continue;
      const seq = upd.seq ?? upd.Seq;
      const { data, status } = await api.get("/api/scores/stat-validation", {
        params: { fixtureId: fid, seq, statKey: 1 },
        validateStatus: () => true,
      });
      // zero-valued stats trip the oracle's StatNotZero (6074) R2 check —
      // only nonzero stat values are provable by inclusion; also require the
      // packet to be inside the market's resolve window
      if (
        status === 200 &&
        data?.summary &&
        data.statToProve?.value > 0 &&
        data.summary.updateStats.minTimestamp >= minTsMs
      ) {
        console.log(
          `[smoke] provable update: fixture ${fid} seq ${seq} statValue=${data.statToProve.value}`,
        );
        return data;
      }
    }
  }
  return null;
}

async function waitForProofAfter(
  api: ReturnType<typeof apiClient>,
  minTsMs: number,
  fixtureId: number,
  timeoutMs = 15 * 60_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const proof = await scanForProof(api, minTsMs, fixtureId);
    if (proof) return proof;
    console.log("[smoke] no provable update yet, feed may be quiet — retrying in 30s");
    await new Promise((r) => setTimeout(r, 30_000));
  }
  throw new Error("no provable score update appeared inside the resolve window (feed quiet?)");
}

async function main() {
  const creds = await authenticate(network);
  const api = apiClient(network, creds);
  const fixtureId = await pickActiveFixture(api);

  const keypair = loadWallet();
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), {
    commitment: "confirmed",
  });
  const idl = JSON.parse(
    fs.readFileSync(new URL("../../../target/idl/fulltime.json", import.meta.url), "utf8"),
  );
  const program = new anchor.Program(idl, provider);
  console.log("[smoke] fulltime program:", program.programId.toBase58());

  // --- test mint + funded ATA ---
  const mint = await createMint(connection, keypair, keypair.publicKey, null, 6);
  const ata = await getOrCreateAssociatedTokenAccount(connection, keypair, mint, keypair.publicKey);
  await mintTo(connection, keypair, mint, ata.address, keypair, 1_000_000_000);
  console.log("[smoke] test mint:", mint.toBase58());

  // --- derive PDAs ---
  const marketId = new BN(Date.now());
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), keypair.publicKey.toBuffer(), marketId.toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    program.programId,
  );
  const [position] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), keypair.publicKey.toBuffer()],
    program.programId,
  );

  // Resolve window opens shortly in the FUTURE: buy must land before it
  // (TradingClosed gate), and the resolving packet must land after it.
  const resolveAfterSecs = Math.floor(Date.now() / 1000) + RESOLVE_WINDOW_SECS;

  // --- 1. create market: "P1 full-game goals > -1" (provably YES, exercises the whole pipe) ---
  const sigCreate = await program.methods
    .createMarket({
      marketId,
      fixtureId: new BN(fixtureId),
      statKeyA: 1,
      statKeyB: null,
      op: null,
      comparison: { greaterThan: {} },
      threshold: -1,
      seedLiquidity: new BN(100_000_000),
      resolveAfterTs: new BN(resolveAfterSecs),
      finalityDelaySecs: 60,
      voidAfterTs: new BN(Math.floor(Date.now() / 1000) + 86_400),
    })
    .accountsPartial({
      creator: keypair.publicKey,
      market,
      vault,
      creatorToken: ata.address,
      mint,
      oracleProgram: ORACLE_PROGRAM,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log("[smoke] create_market:", sigCreate);

  // --- 2. buy YES ---
  const sigBuy = await program.methods
    .buy({ yes: {} }, new BN(10_000_000), new BN(1))
    .accountsPartial({
      buyer: keypair.publicKey,
      market,
      position,
      vault,
      buyerToken: ata.address,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log("[smoke] buy YES 10.0:", sigBuy);

  // --- 3. wait for a provable packet inside the resolve window, then the
  // finality delay, then resolve via real oracle CPI ---
  const validation = await waitForProofAfter(api, resolveAfterSecs * 1000, fixtureId);
  const packetTsMs: number = validation.summary.updateStats.minTimestamp;
  const packetTsSecs = Math.floor(packetTsMs / 1000);
  const epochDay = Math.floor(packetTsMs / 86_400_000);
  const [dailyScoresRoots] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
    ORACLE_PROGRAM,
  );
  const finalityReadyMs = (packetTsSecs + 60 + 5) * 1000;
  if (Date.now() < finalityReadyMs) {
    console.log(`[smoke] waiting ${Math.ceil((finalityReadyMs - Date.now()) / 1000)}s for finality delay`);
    await new Promise((r) => setTimeout(r, finalityReadyMs - Date.now()));
  }

  const bundle = {
    ts: new BN(packetTsMs),
    fixtureSummary: {
      fixtureId: new BN(validation.summary.fixtureId),
      updateStats: {
        updateCount: validation.summary.updateStats.updateCount,
        minTimestamp: new BN(validation.summary.updateStats.minTimestamp),
        maxTimestamp: new BN(validation.summary.updateStats.maxTimestamp),
      },
      eventsSubTreeRoot: toBytes32(validation.summary.eventStatsSubTreeRoot),
    },
    fixtureProof: toProofNodes(validation.subTreeProof),
    mainTreeProof: toProofNodes(validation.mainTreeProof),
    statA: {
      statToProve: validation.statToProve,
      eventStatRoot: toBytes32(validation.eventStatRoot),
      statProof: toProofNodes(validation.statProof),
    },
    statB: null,
  };
  const sigResolve = await program.methods
    .resolve(bundle)
    .accountsPartial({
      keeper: keypair.publicKey,
      market,
      oracleProgram: ORACLE_PROGRAM,
      dailyScoresRoots,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
    .rpc();
  console.log("[smoke] resolve:", sigResolve);

  const marketState: any = await (program.account as any).market.fetch(market);
  console.log("[smoke] market status:", JSON.stringify(marketState.status));

  // --- 4. claim winnings ---
  const sigClaim = await program.methods
    .claim()
    .accountsPartial({
      claimer: keypair.publicKey,
      market,
      position,
      vault,
      claimerToken: ata.address,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log("[smoke] claim:", sigClaim);

  // --- 5. creator withdraws remaining pool ---
  const sigWithdraw = await program.methods
    .withdrawLiquidity()
    .accountsPartial({
      creator: keypair.publicKey,
      market,
      vault,
      creatorToken: ata.address,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log("[smoke] withdraw_liquidity:", sigWithdraw);

  const vaultAcc = await getAccount(connection, vault);
  const walletAcc = await getAccount(connection, ata.address);
  console.log("[smoke] vault balance:", vaultAcc.amount.toString(), "(must be 0)");
  console.log("[smoke] wallet balance:", walletAcc.amount.toString(), "(must be 1000000000)");
  if (vaultAcc.amount !== 0n) throw new Error("vault not drained");
  if (walletAcc.amount !== 1_000_000_000n) throw new Error("wallet balance mismatch");

  console.log("\n[smoke] ✅ FULL LOOP VERIFIED ON DEVNET");
  console.log(`[smoke] market: https://explorer.solana.com/address/${market.toBase58()}?cluster=devnet`);
  console.log(`[smoke] resolve tx: https://explorer.solana.com/tx/${sigResolve}?cluster=devnet`);
}

main().catch((e) => {
  console.error("[smoke] FAILED:", e.message ?? e);
  if (e.logs) console.error(e.logs.slice(-10).join("\n"));
  process.exit(1);
});
