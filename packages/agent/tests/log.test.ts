import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendDecision,
  readDecisions,
  rebuildExposure,
  type DecisionRecord,
} from "../src/log.js";

const trade = (marketPda: string, amountInUnits: string): DecisionRecord => ({
  ts: 1_784_140_000_000,
  fixtureId: 18241006,
  marketPda,
  kind: "trade",
  fairPpm: 700_000,
  poolPpm: 500_000,
  edgePpm: 200_000,
  side: "YES",
  amountInUnits,
  quotedShares: "9545454",
  minSharesOut: "9354544",
  tx: "5sig",
});

let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), "agent-log-")), "decisions.jsonl");
});

describe("append + read roundtrip", () => {
  it("appends one JSON line per record, creating parent dir", () => {
    appendDecision(file, trade("MktA", "5000000"));
    appendDecision(file, { ts: 1, fixtureId: 2, marketPda: "MktB", kind: "skip", reason: "no-fair" });
    const recs = readDecisions(file);
    expect(recs).toHaveLength(2);
    expect(recs[0].marketPda).toBe("MktA");
    expect(recs[1].reason).toBe("no-fair");
  });

  it("readDecisions on missing file returns []", () => {
    expect(readDecisions(join(tmpdir(), "nope", "missing.jsonl"))).toEqual([]);
  });
});

describe("rebuildExposure", () => {
  it("sums trade amounts per market and globally; ignores skips/resolves/failed", () => {
    const recs: DecisionRecord[] = [
      trade("MktA", "5000000"),
      trade("MktA", "2000000"),
      trade("MktB", "1000000"),
      { ...trade("MktC", "9000000"), tx: undefined, error: "SlippageExceeded" }, // failed → no exposure
      { ts: 1, fixtureId: 2, marketPda: "MktA", kind: "skip", reason: "cooldown" },
      { ts: 1, fixtureId: 2, marketPda: "MktA", kind: "resolve", tx: "sig2" },
    ];
    const { perMarket, globalUnits } = rebuildExposure(recs);
    expect(perMarket.get("MktA")).toBe(7_000_000n);
    expect(perMarket.get("MktB")).toBe(1_000_000n);
    expect(perMarket.has("MktC")).toBe(false);
    expect(globalUnits).toBe(8_000_000n);
  });
});
