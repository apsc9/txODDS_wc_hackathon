import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fixturesDue, runKeeperPass } from "../src/keeper.js";
import type { AgentMarket } from "../src/engine.js";
import { readDecisions } from "../src/log.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/engine.js";

const NOW_MS = 1_784_140_000_000;
const NOW_SEC = NOW_MS / 1000;

const mkt = (fixtureId: number, over: Partial<AgentMarket> = {}): AgentMarket => ({
  pda: `Mkt${fixtureId}`,
  fixtureId,
  mint: "Mint1",
  poolYes: "1",
  poolNo: "1",
  resolveAfterTs: NOW_SEC - 100, // window passed
  status: "Open",
  yesPpm: 500_000,
  fairPpm: null,
  ...over,
});

describe("fixturesDue", () => {
  it("returns fixtures with an Open market past resolveAfterTs", () => {
    const ms = [
      mkt(1),
      mkt(2, { resolveAfterTs: NOW_SEC + 100 }), // not yet due
      mkt(3, { status: "ResolvedYes" }), // nothing open
    ];
    expect(fixturesDue(ms, NOW_SEC, new Map(), 120_000, NOW_MS)).toEqual([1]);
  });

  it("respects per-fixture min interval", () => {
    const last = new Map([[1, NOW_MS - 60_000]]); // passed 1 min ago, interval 2 min
    expect(fixturesDue([mkt(1)], NOW_SEC, last, 120_000, NOW_MS)).toEqual([]);
    const stale = new Map([[1, NOW_MS - 180_000]]);
    expect(fixturesDue([mkt(1)], NOW_SEC, stale, 120_000, NOW_MS)).toEqual([1]);
  });

  it("dedupes multiple due markets on one fixture", () => {
    expect(fixturesDue([mkt(1), mkt(1, { pda: "Other" })], NOW_SEC, new Map(), 0, NOW_MS)).toEqual([1]);
  });
});

describe("runKeeperPass", () => {
  // runKeeperPass computes "now" via Date.now() internally (fixturesDue's
  // callers get nowMs injected, but runKeeperPass itself doesn't take one —
  // see keeper.ts). Pin the clock to NOW_MS so mkt(1)'s fixed
  // resolveAfterTs (NOW_SEC - 100) reads as "already due" deterministically,
  // independent of wall-clock time when the suite happens to run.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls resolvePass per due fixture, logs result lines, stamps lastPass", async () => {
    const cfg = {
      apiBase: "http://t",
      fixtureIds: null,
      live: true,
      logPath: join(mkdtempSync(join(tmpdir(), "agent-")), "d.jsonl"),
      engine: { ...DEFAULT_CONFIG },
    };
    const resolvePass = vi.fn(async () => ["OK    Mkt1 → resolvedNo tx SIG", "SKIP  Mkt2 — zero"]);
    const lastPass = new Map<number, number>();
    await runKeeperPass(cfg, [mkt(1)], lastPass, resolvePass);
    expect(resolvePass).toHaveBeenCalledWith(1);
    expect(lastPass.has(1)).toBe(true);
    const recs = readDecisions(cfg.logPath);
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({ kind: "resolve", fixtureId: 1, detail: "OK    Mkt1 → resolvedNo tx SIG" });
  });

  it("dry-run mode does NOT invoke resolvePass, logs skip", async () => {
    const cfg = {
      apiBase: "http://t",
      fixtureIds: null,
      live: false,
      logPath: join(mkdtempSync(join(tmpdir(), "agent-")), "d.jsonl"),
      engine: { ...DEFAULT_CONFIG },
    };
    const resolvePass = vi.fn();
    await runKeeperPass(cfg, [mkt(1)], new Map(), resolvePass);
    expect(resolvePass).not.toHaveBeenCalled();
    expect(readDecisions(cfg.logPath)[0]).toMatchObject({ kind: "skip", reason: "dry-run", fixtureId: 1 });
  });
});
