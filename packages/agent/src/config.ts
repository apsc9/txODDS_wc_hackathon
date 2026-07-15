import { Keypair } from "@solana/web3.js";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, type EngineConfig } from "./engine.js";

// Same devnet endpoints packages/ingest/src/config.ts uses; duplicated here
// (two small constants) rather than importing across packages.
export const RPC_URL = "https://api.devnet.solana.com";
export const PROGRAM_ID = "2MzYe6Zo4AD2fuszYou7CcnVmo7cdq4WjKi8UERL652L";

export const AGENT_WALLET_PATH = fileURLToPath(
  new URL("../../../.keys/agent-wallet.json", import.meta.url)
);
export const DEV_WALLET_PATH = fileURLToPath(
  new URL("../../../.keys/dev-wallet.json", import.meta.url)
);
export const STAKE_MINT_PATH = fileURLToPath(
  new URL("../../../.keys/stake-mint.json", import.meta.url)
);
// Tracked IDL (byte-identical to untracked target/idl/fulltime.json —
// verified in the Track 1 final review); agent must build from fresh clone.
export const IDL_PATH = fileURLToPath(
  new URL("../../../apps/web/src/idl/fulltime.json", import.meta.url)
);
export const DEFAULT_LOG_PATH = fileURLToPath(
  new URL("../../../data/agent/decisions.jsonl", import.meta.url)
);

export type AgentConfig = {
  apiBase: string;
  fixtureIds: number[] | null; // null = auto-discover from /api/fixtures
  live: boolean;
  logPath: string;
  engine: EngineConfig;
};

export function parseArgs(argv: string[]): AgentConfig {
  const cfg: AgentConfig = {
    apiBase: "http://localhost:3000",
    fixtureIds: null,
    live: false,
    logPath: DEFAULT_LOG_PATH,
    engine: { ...DEFAULT_CONFIG },
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") cfg.live = true;
    else if (a === "--api") cfg.apiBase = argv[++i];
    else if (a === "--log") cfg.logPath = argv[++i];
    else if (a === "--fixtures") {
      const ids = (argv[++i] ?? "").split(",").map((s) => Number(s.trim()));
      if (ids.length === 0 || ids.some((n) => !Number.isInteger(n))) {
        throw new Error("--fixtures expects comma-separated integer ids");
      }
      cfg.fixtureIds = ids;
    } else throw new Error(`unknown flag: ${a}`);
  }
  return cfg;
}

export function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));
}

export function loadAgentWallet(): Keypair {
  return loadKeypair(AGENT_WALLET_PATH);
}
