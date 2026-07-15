import type { AgentMarket } from "./engine.js";
import { appendDecision } from "./log.js";
import type { AgentConfig } from "./config.js";

// Fixtures with at least one Open market whose resolve window has opened,
// rate-limited per fixture (keeper passes hit TxLINE + devnet RPC hard).
export function fixturesDue(
  markets: AgentMarket[],
  nowSec: number,
  lastPass: Map<number, number>,
  minIntervalMs: number,
  nowMs: number
): number[] {
  const due = new Set<number>();
  for (const m of markets) {
    if (m.status !== "Open") continue;
    if (nowSec < m.resolveAfterTs) continue;
    const last = lastPass.get(m.fixtureId) ?? 0;
    if (nowMs - last < minIntervalMs) continue;
    due.add(m.fixtureId);
  }
  return Array.from(due);
}

async function defaultResolvePass(fixtureId: number): Promise<string[]> {
  // Lazy import: pulls in ingest's axios/auth chain only when a fixture is
  // actually due (and never in unit tests).
  const { runResolvePass } = await import("../../ingest/src/resolve-markets.js");
  return runResolvePass(fixtureId);
}

export async function runKeeperPass(
  cfg: AgentConfig,
  markets: AgentMarket[],
  lastPass: Map<number, number>,
  resolvePass: (fixtureId: number) => Promise<string[]> = defaultResolvePass
): Promise<void> {
  const nowMs = Date.now();
  const due = fixturesDue(markets, nowMs / 1000, lastPass, 120_000, nowMs);
  for (const fixtureId of due) {
    if (!cfg.live) {
      appendDecision(cfg.logPath, {
        ts: nowMs,
        fixtureId,
        marketPda: "",
        kind: "skip",
        reason: "dry-run",
        detail: "keeper pass due",
      });
      console.log(`[keeper] DRY-RUN would resolve fixture ${fixtureId}`);
      lastPass.set(fixtureId, nowMs);
      continue;
    }
    try {
      const lines = await resolvePass(fixtureId);
      for (const detail of lines) {
        appendDecision(cfg.logPath, { ts: Date.now(), fixtureId, marketPda: "", kind: "resolve", detail });
      }
    } catch (e: any) {
      appendDecision(cfg.logPath, {
        ts: Date.now(),
        fixtureId,
        marketPda: "",
        kind: "resolve",
        error: String(e?.message ?? e),
      });
    }
    lastPass.set(fixtureId, nowMs);
  }
}
