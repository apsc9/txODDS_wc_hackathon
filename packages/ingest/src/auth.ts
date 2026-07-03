/**
 * TxLINE auth flow:
 *   1. guest JWT via POST {apiOrigin}/auth/guest/start
 *   2. on-chain `subscribe(serviceLevelId, weeks)` on the matching network
 *   3. sign `${txSig}:${leagues}:${jwt}` with the wallet
 *   4. POST {apiOrigin}/api/token/activate -> API token
 * Persists creds to .keys/txline-creds.<network>.json and reuses them if still valid.
 */
import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import axios from "axios";
import nacl from "tweetnacl";
import fs from "node:fs";
import { CONFIG, CREDS_PATH, WALLET_PATH, type Network } from "./config.js";

export interface TxlineCreds {
  network: Network;
  jwt: string;
  apiToken: string;
  txSig: string;
  wallet: string;
  activatedAt: string;
}

export function loadWallet(): Keypair {
  const raw = JSON.parse(fs.readFileSync(WALLET_PATH, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function loadCreds(network: Network): TxlineCreds | null {
  const p = CREDS_PATH(network);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export async function authenticate(network: Network, opts?: { forceResubscribe?: boolean }): Promise<TxlineCreds> {
  const cfg = CONFIG[network];
  const cached = loadCreds(network);
  if (cached && !opts?.forceResubscribe) {
    const ok = await probe(network, cached);
    if (ok) return cached;
    console.log(`[auth] cached ${network} creds rejected, re-authenticating`);
  }

  const keypair = loadWallet();
  const wallet = new anchor.Wallet(keypair);
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const idl = JSON.parse(
    fs.readFileSync(new URL(`../../../docs/txline/txline-${network}-idl.json`, import.meta.url), "utf8"),
  );
  const program = new anchor.Program(idl, provider);
  if (!program.programId.equals(cfg.programId)) {
    throw new Error(`IDL program ${program.programId} != expected ${cfg.programId} on ${network}`);
  }

  const SELECTED_LEAGUES: number[] = [];
  const DURATION_WEEKS = 4;

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    program.programId,
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    cfg.txlTokenMint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    program.programId,
  );
  const userTokenAccount = getAssociatedTokenAddressSync(
    cfg.txlTokenMint,
    keypair.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  console.log(`[auth] subscribing on ${network} service level ${cfg.serviceLevelId}…`);
  // The program requires the user's TxL ATA to exist even for free tiers (error 3012 otherwise).
  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    keypair.publicKey,
    userTokenAccount,
    keypair.publicKey,
    cfg.txlTokenMint,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const txSig = await program.methods
    .subscribe(cfg.serviceLevelId, DURATION_WEEKS)
    .preInstructions([createAtaIx])
    .accounts({
      user: keypair.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: cfg.txlTokenMint,
      userTokenAccount,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`[auth] subscribe tx: ${txSig}`);

  const { data: authResp } = await axios.post(`${cfg.apiOrigin}/auth/guest/start`);
  const jwt: string = authResp.token;

  const message = new TextEncoder().encode(`${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`);
  const walletSignature = Buffer.from(nacl.sign.detached(message, keypair.secretKey)).toString("base64");

  const { data: act } = await axios.post(
    `${cfg.apiOrigin}/api/token/activate`,
    { txSig, walletSignature, leagues: SELECTED_LEAGUES },
    { headers: { Authorization: `Bearer ${jwt}` } },
  );
  const apiToken: string = act.token ?? act;

  const creds: TxlineCreds = {
    network,
    jwt,
    apiToken,
    txSig,
    wallet: keypair.publicKey.toBase58(),
    activatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(CREDS_PATH(network), JSON.stringify(creds, null, 2));
  console.log(`[auth] activated on ${network}, creds saved`);
  return creds;
}

export function apiClient(network: Network, creds: TxlineCreds) {
  return axios.create({
    baseURL: CONFIG[network].apiOrigin,
    timeout: 30_000,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.jwt}`,
      "X-Api-Token": creds.apiToken,
    },
  });
}

async function probe(network: Network, creds: TxlineCreds): Promise<boolean> {
  try {
    const res = await apiClient(network, creds).get("/api/fixtures/snapshot", {
      params: { limit: 1 },
      validateStatus: () => true,
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
