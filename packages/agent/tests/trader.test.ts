import { describe, it, expect, vi } from "vitest";
import { fetchOpenMarkets, makeTrader } from "../src/trader.js";
import { DEFAULT_CONFIG, type AgentMarket } from "../src/engine.js";
import type { AgentConfig } from "../src/config.js";
import { readDecisions } from "../src/log.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NOW = 1_784_140_000_000;

const mkt = (over: Partial<AgentMarket> = {}): AgentMarket => ({
  pda: "MktA",
  fixtureId: 18241006,
  mint: "Mint1",
  poolYes: "50000000",
  poolNo: "50000000",
  resolveAfterTs: NOW / 1000 + 3600,
  status: "Open",
  yesPpm: 500_000,
  fairPpm: 700_000,
  ...over,
});

function cfg(live: boolean): AgentConfig {
  return {
    apiBase: "http://test",
    fixtureIds: [18241006],
    live,
    logPath: join(mkdtempSync(join(tmpdir(), "agent-")), "decisions.jsonl"),
    engine: { ...DEFAULT_CONFIG },
  };
}

describe("fetchOpenMarkets", () => {
  it("fetches per-fixture markets, explicit ids skip /api/fixtures", async () => {
    const fetchFn = vi.fn(async (url: any) => ({
      ok: true,
      json: async () => ({ markets: [mkt()] }),
    })) as any;
    const ms = await fetchOpenMarkets("http://test", [18241006], fetchFn);
    expect(ms).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toBe("http://test/api/markets?fixtureId=18241006");
  });

  it("auto-discovers fixture ids when null", async () => {
    const fetchFn = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.endsWith("/api/fixtures")) {
        return { ok: true, json: async () => ({ fixtures: [{ FixtureId: 7 }, { FixtureId: 9 }] }) };
      }
      return { ok: true, json: async () => ({ markets: [mkt({ fixtureId: Number(u.split("=")[1]) })] }) };
    }) as any;
    const ms = await fetchOpenMarkets("http://test", null, fetchFn);
    expect(ms.map((m) => m.fixtureId)).toEqual([7, 9]);
  });
});

describe("makeTrader tick", () => {
  it("dry-run: logs would-be trade as skip dry-run, does NOT call executeBuy", async () => {
    const executeBuy = vi.fn();
    const c = cfg(false);
    const t = makeTrader(c, {
      fetchMarkets: async () => [mkt()],
      executeBuy,
      now: () => NOW,
    });
    await t.tick();
    expect(executeBuy).not.toHaveBeenCalled();
    const recs = readDecisions(c.logPath);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ kind: "skip", reason: "dry-run", side: "YES", marketPda: "MktA" });
    // dry-run must not consume budget
    expect(t.state.globalSpentUnits).toBe(0n);
  });

  it("live: executes trade, logs tx, accrues exposure + cooldown", async () => {
    const executeBuy = vi.fn(async () => "SIG1");
    const c = cfg(true);
    const t = makeTrader(c, { fetchMarkets: async () => [mkt()], executeBuy, now: () => NOW });
    await t.tick();
    expect(executeBuy).toHaveBeenCalledTimes(1);
    const recs = readDecisions(c.logPath);
    expect(recs[0]).toMatchObject({ kind: "trade", tx: "SIG1", amountInUnits: "5000000" });
    expect(t.state.globalSpentUnits).toBe(5_000_000n);
    // immediate second tick → cooldown, no second buy; cooldown is a QUIET
    // skip (recurs every 5s tick), so the log stays at one line
    await t.tick();
    expect(executeBuy).toHaveBeenCalledTimes(1);
    expect(readDecisions(c.logPath)).toHaveLength(1);
  });

  it("live: failed buy logs error and does NOT accrue exposure", async () => {
    const executeBuy = vi.fn(async () => {
      throw new Error("SlippageExceeded");
    });
    const c = cfg(true);
    const t = makeTrader(c, { fetchMarkets: async () => [mkt()], executeBuy, now: () => NOW });
    await t.tick();
    const recs = readDecisions(c.logPath);
    expect(recs[0].kind).toBe("trade");
    expect(recs[0].error).toMatch(/Slippage/);
    expect(recs[0].tx).toBeUndefined();
    expect(t.state.globalSpentUnits).toBe(0n);
  });

  it("rebuilds exposure from existing log on construction", async () => {
    const c = cfg(true);
    const t1 = makeTrader(c, {
      fetchMarkets: async () => [mkt()],
      executeBuy: async () => "SIG1",
      now: () => NOW,
    });
    await t1.tick();
    const t2 = makeTrader(c, { fetchMarkets: async () => [], executeBuy: vi.fn(), now: () => NOW });
    expect(t2.state.globalSpentUnits).toBe(5_000_000n);
    expect(t2.state.perMarket.get("MktA")?.exposureUnits).toBe(5_000_000n);
  });

  it("quiet on small-edge skips (not logged) to keep the log demo-readable", async () => {
    const c = cfg(false);
    const t = makeTrader(c, {
      fetchMarkets: async () => [mkt({ fairPpm: 510_000 })],
      executeBuy: vi.fn(),
      now: () => NOW,
    });
    await t.tick();
    expect(readDecisions(c.logPath)).toHaveLength(0);
  });
});
