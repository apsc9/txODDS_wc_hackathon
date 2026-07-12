import { describe, it, expect } from "vitest";
import {
  CREATE_FINALITY_DELAY_SECS,
  MIN_SEED_LIQUIDITY,
  defaultTimes,
  localInputToTs,
  mapCreateError,
  mintForFixture,
  parseTokenAmount,
  predicateToAnchorArgs,
  presetPredicate,
  tsToLocalInput,
} from "../src/hooks/use-create-market";
import { canNeedZeroStat } from "../src/lib/statkeys";
import type { MarketDTO } from "../src/lib/types";

// Same minimal-DTO builder shape as tests/use-trade.test.ts — 50/50 seeded
// pool defaults matching the devnet seeder.
function makeMarket(overrides: Partial<MarketDTO> = {}): MarketDTO {
  return {
    pda: "Pda1111111111111111111111111111111111111",
    creator: "Creator111111111111111111111111111111111",
    marketId: "1823703800",
    fixtureId: 18237038,
    mint: "Mint111111111111111111111111111111111111",
    poolYes: "50000000",
    poolNo: "50000000",
    seedLiquidity: "50000000",
    resolveAfterTs: 0,
    finalityDelaySecs: 0,
    voidAfterTs: 0,
    status: "Open",
    yesPpm: 500_000,
    fairPpm: null,
    statKeyA: 1,
    statKeyB: null,
    op: null,
    comparison: "GreaterThan",
    threshold: 0,
    ...overrides,
  };
}

describe("defaultTimes (resolve/void defaults from a 13-digit StartTime)", () => {
  // Fixture 18237038 France–Spain: StartTime 1784055600000 (epoch ms).
  it("resolveAfter = StartTime/1000 + 105min, voidAfter = +48h, finality 600", () => {
    const t = defaultTimes(1784055600000);
    expect(t.resolveAfterTs).toBe(1784055600 + 105 * 60);
    expect(t.voidAfterTs).toBe(t.resolveAfterTs + 48 * 3600);
    expect(CREATE_FINALITY_DELAY_SECS).toBe(600);
  });

  it("floors sub-second millis rather than rounding up", () => {
    expect(defaultTimes(1784055600999).resolveAfterTs).toBe(1784055600 + 105 * 60);
  });
});

describe("presetPredicate (preset → statKey/predicate encoding, FT-only)", () => {
  it("total goals over N → GOALS_T1 + GOALS_T2 > N", () => {
    expect(presetPredicate("goals", 2)).toEqual({
      statKeyA: 1,
      statKeyB: 2,
      op: "Add",
      comparison: "GreaterThan",
      threshold: 2,
    });
  });

  it("total corners over N → CORNERS_T1 + CORNERS_T2 > N", () => {
    expect(presetPredicate("corners", 9)).toEqual({
      statKeyA: 7,
      statKeyB: 8,
      op: "Add",
      comparison: "GreaterThan",
      threshold: 9,
    });
  });

  it("total yellows over N → YELLOWS_T1 + YELLOWS_T2 > N", () => {
    expect(presetPredicate("yellows", 3)).toEqual({
      statKeyA: 3,
      statKeyB: 4,
      op: "Add",
      comparison: "GreaterThan",
      threshold: 3,
    });
  });

  it("home team to win → GOALS_T1 - GOALS_T2 > 0 regardless of threshold arg", () => {
    expect(presetPredicate("homeWin", 7)).toEqual({
      statKeyA: 1,
      statKeyB: 2,
      op: "Subtract",
      comparison: "GreaterThan",
      threshold: 0,
    });
  });

  it("preset goals/corners/yellows don't need zero stat (threshold ≥ 1), but homeWin does (threshold 0)", () => {
    expect(canNeedZeroStat(presetPredicate("goals", 2))).toBe(false);
    expect(canNeedZeroStat(presetPredicate("corners", 9))).toBe(false);
    expect(canNeedZeroStat(presetPredicate("yellows", 3))).toBe(false);
    expect(canNeedZeroStat(presetPredicate("homeWin", 0))).toBe(true);
  });
});

describe("predicateToAnchorArgs (string unions → anchor enum objects)", () => {
  it("Add + GreaterThan two-stat predicate", () => {
    expect(
      predicateToAnchorArgs({
        statKeyA: 1,
        statKeyB: 2,
        op: "Add",
        comparison: "GreaterThan",
        threshold: 2,
      })
    ).toEqual({
      statKeyA: 1,
      statKeyB: 2,
      op: { add: {} },
      comparison: { greaterThan: {} },
      threshold: 2,
    });
  });

  it("Subtract + EqualTo", () => {
    const a = predicateToAnchorArgs({
      statKeyA: 1,
      statKeyB: 2,
      op: "Subtract",
      comparison: "EqualTo",
      threshold: 0,
    });
    expect(a.op).toEqual({ subtract: {} });
    expect(a.comparison).toEqual({ equalTo: {} });
  });

  it("single-stat predicate keeps statKeyB/op null (IDL options)", () => {
    const a = predicateToAnchorArgs({
      statKeyA: 1007,
      statKeyB: null,
      op: null,
      comparison: "LessThan",
      threshold: 4,
    });
    expect(a.statKeyB).toBeNull();
    expect(a.op).toBeNull();
    expect(a.comparison).toEqual({ lessThan: {} });
  });
});

describe("mintForFixture", () => {
  it("reuses the fixture's existing markets' mint when any exist", () => {
    const markets = [makeMarket({ mint: "ExistingMint1111111111111111111111111111" })];
    expect(mintForFixture(markets)).toBe("ExistingMint1111111111111111111111111111");
  });

  it("null when the fixture has no markets yet (caller falls back to env)", () => {
    expect(mintForFixture([])).toBeNull();
  });
});

describe("parseTokenAmount / MIN_SEED_LIQUIDITY", () => {
  it("parses whole and fractional token amounts to 6-decimal base units", () => {
    expect(parseTokenAmount("50")).toBe(50_000_000n);
    expect(parseTokenAmount("10.5")).toBe(10_500_000n);
  });

  it("rejects empty and non-numeric input", () => {
    expect(parseTokenAmount("")).toBeNull();
    expect(parseTokenAmount("abc")).toBeNull();
    expect(parseTokenAmount("1.2345678")).toBeNull();
  });

  it("minimum seed liquidity is 10 tokens", () => {
    expect(MIN_SEED_LIQUIDITY).toBe(10_000_000n);
  });
});

describe("datetime-local conversion (local-timezone round trip)", () => {
  it("round-trips a minute-aligned unix timestamp", () => {
    const ts = 1784061900; // minute-aligned (…:05:00 UTC)
    expect(localInputToTs(tsToLocalInput(ts))).toBe(ts);
  });

  it("formats as the datetime-local shape YYYY-MM-DDTHH:MM", () => {
    expect(tsToLocalInput(1784061900)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("returns null for empty or unparseable input", () => {
    expect(localInputToTs("")).toBeNull();
    expect(localInputToTs("not-a-date")).toBeNull();
  });
});

describe("mapCreateError", () => {
  it("maps wallet rejection verbatim", () => {
    expect(mapCreateError(new Error("User rejected the request."))).toBe("Cancelled in wallet");
  });

  it("maps 0x1 (insufficient funds) to test-USDC copy", () => {
    expect(
      mapCreateError(new Error("Transaction simulation failed: custom program error: 0x1"))
    ).toBe("Market not created — not enough test USDC in wallet");
  });

  it("falls back to 'Market not created — <short message>', never a raw code alone", () => {
    const result = mapCreateError(new Error("Some unrelated RPC hiccup"));
    expect(result.startsWith("Market not created — ")).toBe(true);
    expect(result).toContain("Some unrelated RPC hiccup");
  });
});
