import { PublicKey } from "@solana/web3.js";

export type Network = "mainnet" | "devnet";

export const CONFIG = {
  mainnet: {
    rpcUrl: process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com",
    apiOrigin: "https://txline.txodds.com",
    programId: new PublicKey("9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA"),
    txlTokenMint: new PublicKey("Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL"),
    // Free World Cup tiers: 1 = 60s delayed, 12 = real-time
    serviceLevelId: 12,
  },
  devnet: {
    rpcUrl: process.env.DEVNET_RPC ?? "https://api.devnet.solana.com",
    apiOrigin: "https://txline-dev.txodds.com",
    programId: new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"),
    txlTokenMint: new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG"),
    // Devnet only documents service level 1 (60s delayed)
    serviceLevelId: 1,
  },
} as const;

export const WALLET_PATH =
  process.env.WALLET_PATH ?? new URL("../../../.keys/dev-wallet.json", import.meta.url).pathname;

export const CREDS_PATH = (network: Network) =>
  new URL(`../../../.keys/txline-creds.${network}.json`, import.meta.url).pathname;

export const RECORDINGS_DIR = new URL("../../../data/recordings/", import.meta.url).pathname;
