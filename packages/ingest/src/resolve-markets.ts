/**
 * Keeper: resolve all Open FullTime markets on a finished fixture by
 * submitting TxLINE stat-validation merkle proofs on-chain.
 *
 * For each Open market on the fixture it fetches a proof for statKeyA (and
 * statKeyB when set) at the fixture's latest score update, builds the
 * ValidationBundle exactly like smoke-devnet.ts, and calls `resolve`.
 *
 * Markets whose stat value is 0 are SKIPPED loudly — zero stats are not
 * provable by inclusion (oracle StatNotZero / 6074), those markets settle
 * via the void path after void_after_ts instead.
 *
 * Usage: npx tsx src/resolve-markets.ts <fixtureId>
 */
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, Connection, ComputeBudgetProgram } from "@solana/web3.js";
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

type Api = ReturnType<typeof apiClient>;

// Latest score-update seq for the fixture: scan 5-min update buckets
// backwards from now (same endpoint smoke-devnet uses) and keep the highest
// seq seen for this fixture.
async function latestSeq(api: Api, fixtureId: number): Promise<number> {
  const now = Date.now();
  let best = -1;
  for (let back = 0; back < 12 * 24; back++) {
    const t = new Date(now - back * 300_000);
    const epochDay = Math.floor(t.getTime() / 86_400_000);
    const res = await api.get(
      `/api/scores/updates/${epochDay}/${t.getUTCHours()}/${Math.floor(t.getUTCMinutes() / 5)}`,
      { validateStatus: () => true },
    );
    if (res.status !== 200 || !Array.isArray(res.data)) continue;
    for (const upd of res.data) {
      const fid = upd.fixtureId ?? upd.FixtureId;
      const seq = upd.seq ?? upd.Seq;
      if (fid === fixtureId && typeof seq === "number" && seq > best) best = seq;
    }
    if (best >= 0 && back > 6) break; // found updates and scanned past FT window
  }
  if (best < 0) throw new Error(`no score updates found for fixture ${fixtureId}`);
  return best;
}

async function fetchProof(api: Api, fixtureId: number, seq: number, statKey: number) {
  const { data, status } = await api.get("/api/scores/stat-validation", {
    params: { fixtureId, seq, statKey },
    validateStatus: () => true,
  });
  if (status !== 200 || !data?.summary) {
    throw new Error(`stat-validation ${status} for statKey ${statKey} seq ${seq}`);
  }
  return data;
}

const statPart = (v: any) => ({
  statToProve: v.statToProve,
  eventStatRoot: toBytes32(v.eventStatRoot),
  statProof: toProofNodes(v.statProof),
});

async function main() {
  const fixtureId = Number(process.argv[2]);
  if (!Number.isInteger(fixtureId)) throw new Error("usage: resolve-markets.ts <fixtureId>");

  const creds = await authenticate(network);
  const api = apiClient(network, creds);
  const keypair = loadWallet();
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), {
    commitment: "confirmed",
  });
  const idl = JSON.parse(
    fs.readFileSync(new URL("../../../target/idl/fulltime.json", import.meta.url), "utf8"),
  );
  const program = new anchor.Program(idl, provider);

  // Fetch all markets and filter client-side — same approach as chain.ts's
  // poll (its comment notes getProgramAccounts filters are flaky on public
  // devnet RPC).
  const all: any[] = (await (program.account as any).market.all()).filter(
    (m: any) => Number(m.account.fixtureId) === fixtureId,
  );
  const open = all.filter((m) => "open" in m.account.status);
  console.log(`[keeper] fixture ${fixtureId}: ${all.length} markets, ${open.length} open`);

  const seq = await latestSeq(api, fixtureId);
  console.log(`[keeper] latest score update seq: ${seq}`);

  const results: string[] = [];
  for (const m of open) {
    const acc = m.account;
    const pda: PublicKey = m.publicKey;
    const label = `${pda.toBase58().slice(0, 8)} statA=${acc.statKeyA} statB=${acc.statKeyB ?? "—"}`;
    try {
      const proofA = await fetchProof(api, fixtureId, seq, acc.statKeyA);
      if (!(proofA.statToProve?.value > 0)) {
        results.push(`SKIP  ${label} — statA value ${proofA.statToProve?.value} (zero unprovable, void path)`);
        continue;
      }
      let proofB: any = null;
      if (acc.statKeyB !== null && acc.statKeyB !== undefined) {
        proofB = await fetchProof(api, fixtureId, seq, acc.statKeyB);
        if (!(proofB.statToProve?.value > 0)) {
          results.push(`SKIP  ${label} — statB value ${proofB.statToProve?.value} (zero unprovable, void path)`);
          continue;
        }
      }

      const packetTsMs: number = proofA.summary.updateStats.minTimestamp;
      const epochDay = Math.floor(packetTsMs / 86_400_000);
      const [dailyScoresRoots] = PublicKey.findProgramAddressSync(
        [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
        ORACLE_PROGRAM,
      );

      const bundle = {
        ts: new BN(packetTsMs),
        fixtureSummary: {
          fixtureId: new BN(proofA.summary.fixtureId),
          updateStats: {
            updateCount: proofA.summary.updateStats.updateCount,
            minTimestamp: new BN(proofA.summary.updateStats.minTimestamp),
            maxTimestamp: new BN(proofA.summary.updateStats.maxTimestamp),
          },
          eventsSubTreeRoot: toBytes32(proofA.summary.eventStatsSubTreeRoot),
        },
        fixtureProof: toProofNodes(proofA.subTreeProof),
        mainTreeProof: toProofNodes(proofA.mainTreeProof),
        statA: statPart(proofA),
        statB: proofB ? statPart(proofB) : null,
      };

      const sig = await program.methods
        .resolve(bundle)
        .accountsPartial({
          keeper: keypair.publicKey,
          market: pda,
          oracleProgram: ORACLE_PROGRAM,
          dailyScoresRoots,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
        .rpc();
      const after: any = await (program.account as any).market.fetch(pda);
      results.push(`OK    ${label} → ${JSON.stringify(after.status)} tx ${sig}`);
    } catch (e: any) {
      results.push(`FAIL  ${label} — ${e.message ?? e}`);
      if (e.logs) console.error(e.logs.slice(-6).join("\n"));
    }
  }

  console.log("\n[keeper] summary:");
  for (const r of results) console.log("  " + r);
}

main().catch((e) => {
  console.error("[keeper] FAILED:", e.message ?? e);
  process.exit(1);
});
