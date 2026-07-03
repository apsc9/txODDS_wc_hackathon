/**
 * Phase 0 go/no-go spike: fetch a real stat-validation proof from TxLINE devnet
 * and run `validate_stat` against the on-chain daily_scores_roots PDA via .view().
 * Also measures compute units via simulation.
 *
 * Usage: npx tsx src/spike-validate.ts [fixtureId]
 */
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, ComputeBudgetProgram, Connection } from "@solana/web3.js";
import fs from "node:fs";
import { CONFIG } from "./config.js";
import { authenticate, apiClient, loadWallet } from "./auth.js";

const network = "devnet" as const;
const cfg = CONFIG[network];

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

async function main() {
  const creds = await authenticate(network);
  const api = apiClient(network, creds);

  // 1. find a fixture with score updates: walk recent 5-min intervals backwards
  let updates: any[] = [];
  const now = Date.now();
  for (let back = 3; back < 12 * 24 * 14 && updates.length === 0; back++) {
    const t = new Date(now - back * 300_000);
    const epochDay = Math.floor(t.getTime() / 86_400_000);
    const hourOfDay = t.getUTCHours();
    const interval = Math.floor(t.getUTCMinutes() / 5);
    const res = await api.get(`/api/scores/updates/${epochDay}/${hourOfDay}/${interval}`, {
      validateStatus: () => true,
    });
    if (res.status === 200 && Array.isArray(res.data) && res.data.length > 0) {
      updates = res.data;
      console.log(`[spike] found ${updates.length} score updates at day=${epochDay} h=${hourOfDay} i=${interval} (${back * 5}min ago)`);
    }
  }
  if (updates.length === 0) throw new Error("no score updates found in lookback window");

  const cliFixture = process.argv[2] ? Number(process.argv[2]) : undefined;
  const upd = cliFixture ? updates.find((u: any) => u.fixtureId === cliFixture) ?? updates.at(-1) : updates.at(-1);
  console.log("[spike] using update:", JSON.stringify(upd).slice(0, 400));

  const fixtureId = upd.fixtureId ?? upd.FixtureId;
  const seq = upd.seq ?? upd.Seq;
  const statKey = 1; // participant 1 total goals, full game

  // 2. fetch validation proof
  const { data: validation, status } = await api.get("/api/scores/stat-validation", {
    params: { fixtureId, seq, statKey },
    validateStatus: () => true,
  });
  if (status !== 200) throw new Error(`stat-validation HTTP ${status}: ${JSON.stringify(validation).slice(0, 300)}`);
  console.log("[spike] validation payload keys:", Object.keys(validation));
  fs.writeFileSync(
    new URL("../../../data/spike-validation-sample.json", import.meta.url),
    JSON.stringify(validation, null, 2),
  );

  // 3. build accounts + args
  const keypair = loadWallet();
  const provider = new anchor.AnchorProvider(
    new Connection(cfg.rpcUrl, "confirmed"),
    new anchor.Wallet(keypair),
    { commitment: "confirmed" },
  );
  const idl = JSON.parse(
    fs.readFileSync(new URL(`../../../docs/txline/txline-${network}-idl.json`, import.meta.url), "utf8"),
  );
  const program = new anchor.Program(idl, provider);

  const fixtureSummary = {
    fixtureId: new BN(validation.summary.fixtureId),
    updateStats: {
      updateCount: validation.summary.updateStats.updateCount,
      minTimestamp: new BN(validation.summary.updateStats.minTimestamp),
      maxTimestamp: new BN(validation.summary.updateStats.maxTimestamp),
    },
    eventsSubTreeRoot: toBytes32(validation.summary.eventStatsSubTreeRoot),
  };
  const stat1 = {
    statToProve: validation.statToProve,
    eventStatRoot: toBytes32(validation.eventStatRoot),
    statProof: toProofNodes(validation.statProof),
  };
  const predicate = { threshold: -1, comparison: { greaterThan: {} } }; // goals > -1 always true if proof valid

  const targetTs = validation.summary.updateStats.minTimestamp;
  const epochDay = Math.floor(targetTs / 86_400_000);
  const [dailyScoresPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
    program.programId,
  );
  console.log("[spike] daily_scores_roots PDA:", dailyScoresPda.toBase58(), "epochDay:", epochDay);

  const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

  // 4. view() — result
  const isValid = await program.methods
    .validateStat(
      new BN(targetTs),
      fixtureSummary,
      toProofNodes(validation.subTreeProof),
      toProofNodes(validation.mainTreeProof),
      predicate,
      stat1,
      null,
      null,
    )
    .accounts({ dailyScoresMerkleRoots: dailyScoresPda })
    .preInstructions([computeIx])
    .view();
  console.log(`[spike] validate_stat result: ${isValid}`);

  // 5. simulate for CU measurement
  const tx = await program.methods
    .validateStat(
      new BN(targetTs),
      fixtureSummary,
      toProofNodes(validation.subTreeProof),
      toProofNodes(validation.mainTreeProof),
      predicate,
      stat1,
      null,
      null,
    )
    .accounts({ dailyScoresMerkleRoots: dailyScoresPda })
    .preInstructions([computeIx])
    .transaction();
  tx.feePayer = keypair.publicKey;
  tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
  const sim = await provider.connection.simulateTransaction(tx);
  console.log("[spike] CU consumed:", sim.value.unitsConsumed, "err:", sim.value.err);
  console.log("[spike] logs tail:", (sim.value.logs ?? []).slice(-4).join("\n"));
}

main().catch((e) => {
  console.error("[spike] FAILED:", e.message ?? e);
  process.exit(1);
});
