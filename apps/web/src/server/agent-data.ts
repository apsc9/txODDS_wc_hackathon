import "server-only";

import fs from "node:fs";
import path from "node:path";

import { parseDecisionLog, type DecisionRecord } from "@/lib/agent-report";

// The agent's public key (identity only — never a secret). Default is the
// funded devnet agent wallet from the Track 2 live run; AGENT_PUBKEY env
// overrides it if the agent is ever re-provisioned with a fresh wallet.
export const AGENT_PUBKEY =
  process.env.AGENT_PUBKEY ?? "3SUvdbdwStH9QGL3K1YuZEmPG2hQtvtmk5THk92ti3FD";

export type AgentLog = {
  records: DecisionRecord[];
  source: "live" | "sample" | "none";
};

// Next runs with cwd = apps/web (dev, build, and start alike), so the repo
// root — where data/ lives — is two levels up. Same cwd-relative resolution
// judgment as server/txline.ts's creds-path handling. `baseDir` is
// injectable for tests only.
const REPO_ROOT = path.resolve(process.cwd(), "..", "..");

// data/agent/ is gitignored (real runtime log); data/agent-sample/ is a
// committed copy of the Jul 16 England-Argentina run so a fresh public clone
// renders a real dashboard instead of an empty page. The page labels which
// one it's showing — sample data must never masquerade as live.
export function readAgentLog(baseDir: string = REPO_ROOT): AgentLog {
  const live = path.join(baseDir, "data", "agent", "decisions.jsonl");
  const sample = path.join(baseDir, "data", "agent-sample", "decisions.jsonl");
  if (fs.existsSync(live)) {
    return { records: parseDecisionLog(fs.readFileSync(live, "utf8")), source: "live" };
  }
  if (fs.existsSync(sample)) {
    return { records: parseDecisionLog(fs.readFileSync(sample, "utf8")), source: "sample" };
  }
  return { records: [], source: "none" };
}
