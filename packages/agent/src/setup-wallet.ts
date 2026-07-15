/**
 * One-time agent wallet setup:
 *   1. create .keys/agent-wallet.json if missing
 *   2. transfer 0.05 SOL from dev wallet (fee payer for buys/resolves)
 *   3. mint 200 test-USDC to the agent's ATA (dev wallet = mint authority)
 * Idempotent: re-running tops nothing up if balances already suffice.
 * Usage: npm run setup-wallet
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import fs from "node:fs";
import { AGENT_WALLET_PATH, DEV_WALLET_PATH, STAKE_MINT_PATH, RPC_URL, loadKeypair } from "./config.js";

const TARGET_SOL = 0.05;
const TARGET_USDC_UNITS = 200_000_000n; // 200 tokens @ 6 decimals

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const dev = loadKeypair(DEV_WALLET_PATH);
  // .keys/stake-mint.json is a descriptor ({ mint, createdAt }), not a
  // keypair — packages/ingest/src/seed-markets.ts creates the mint with the
  // dev wallet itself as mint authority, so `dev` signs the mintTo below.
  const mintInfo = JSON.parse(fs.readFileSync(STAKE_MINT_PATH, "utf8")) as { mint: string };
  const mint = new PublicKey(mintInfo.mint);

  let agent: Keypair;
  if (fs.existsSync(AGENT_WALLET_PATH)) {
    agent = loadKeypair(AGENT_WALLET_PATH);
    console.log("[setup] existing agent wallet", agent.publicKey.toBase58());
  } else {
    agent = Keypair.generate();
    fs.writeFileSync(AGENT_WALLET_PATH, JSON.stringify(Array.from(agent.secretKey)));
    console.log("[setup] created agent wallet", agent.publicKey.toBase58());
  }

  const sol = await connection.getBalance(agent.publicKey);
  if (sol < TARGET_SOL * LAMPORTS_PER_SOL) {
    const lamports = Math.round(TARGET_SOL * LAMPORTS_PER_SOL) - sol;
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: dev.publicKey, toPubkey: agent.publicKey, lamports })
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [dev]);
    console.log(`[setup] transferred ${lamports} lamports:`, sig);
  } else {
    console.log("[setup] SOL balance OK:", sol / LAMPORTS_PER_SOL);
  }

  const ata = await getOrCreateAssociatedTokenAccount(connection, dev, mint, agent.publicKey);
  const have = BigInt(ata.amount.toString());
  if (have < TARGET_USDC_UNITS) {
    const sig = await mintTo(connection, dev, mint, ata.address, dev, TARGET_USDC_UNITS - have);
    console.log("[setup] minted test-USDC:", sig);
  } else {
    console.log("[setup] USDC balance OK:", have.toString());
  }

  console.log("[setup] DONE. agent:", agent.publicKey.toBase58(), "ata:", ata.address.toBase58());
}

main().catch((e) => {
  console.error("[setup] FAILED:", e.message ?? e);
  process.exit(1);
});
