import { describe, expect, it } from "vitest";
import {
  buildAgentReport,
  extractResolveTx,
  formatUnits,
  parseDecisionLog,
  ppmToCents,
  summarizeSkips,
  type DecisionRecord,
} from "@/lib/agent-report";
import type { MarketDTO, PositionDTO } from "@/lib/types";

// Minimal valid MarketDTO factory — only fields agent-report reads
// (pda/status/yesPpm) matter, rest are structurally-required noise.
function market(over: Partial<MarketDTO>): MarketDTO {
  return {
    pda: "M1",
    creator: "C",
    marketId: "1",
    fixtureId: 18241006,
    mint: "MINT",
    poolYes: "50000000",
    poolNo: "50000000",
    seedLiquidity: "50000000",
    resolveAfterTs: 0,
    finalityDelaySecs: 0,
    voidAfterTs: 0,
    status: "Open",
    yesPpm: 500000,
    fairPpm: null,
    statKeyA: 1, // FT GOALS_T1 (encodeStatKey(0, BASE.GOALS_T1))
    statKeyB: null,
    op: null,
    comparison: "GreaterThan",
    threshold: 2,
    ...over,
  } as MarketDTO;
}

function position(over: Partial<PositionDTO>): PositionDTO {
  return {
    pda: "P1",
    market: "M1",
    yesShares: "0",
    noShares: "0",
    costPaid: "5000000",
    claimed: false,
    ...over,
  };
}

describe("parseDecisionLog", () => {
  it("parses one record per line", () => {
    const text =
      '{"ts":1,"fixtureId":18241006,"marketPda":"A","kind":"trade","tx":"T1","amountInUnits":"5000000"}\n' +
      '{"ts":2,"fixtureId":18241006,"marketPda":"","kind":"resolve","detail":"OK"}\n';
    const recs = parseDecisionLog(text);
    expect(recs).toHaveLength(2);
    expect(recs[0].kind).toBe("trade");
    expect(recs[1].detail).toBe("OK");
  });

  it("skips corrupt lines and keeps the rest", () => {
    const text =
      '{"ts":1,"fixtureId":1,"marketPda":"A","kind":"skip","reason":"caps"}\n' +
      '{"ts":2,"fixtureId":1,"marketPda":"B",TRUNCATED\n' +
      '{"ts":3,"fixtureId":1,"marketPda":"C","kind":"skip","reason":"closed"}\n';
    const recs = parseDecisionLog(text);
    expect(recs).toHaveLength(2);
    expect(recs.map((r) => r.marketPda)).toEqual(["A", "C"]);
  });

  it("returns [] for empty/whitespace input", () => {
    expect(parseDecisionLog("")).toEqual([]);
    expect(parseDecisionLog("\n  \n")).toEqual([]);
  });
});

describe("buildAgentReport", () => {
  it("marks Open positions to pool-implied price (ppm integer math)", () => {
    // 9545454 NO shares at yesPpm 133730 → NO price 866270 ppm:
    // 9545454 * 866270 / 1e6 = 8268940 (floor)
    const rows = buildAgentReport(
      [position({ noShares: "9545454", costPaid: "5000000" })],
      [market({ status: "Open", yesPpm: 133730 })]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].markUnits).toBe(8268940n);
    expect(rows[0].pnlUnits).toBe(3268940n);
  });

  it("marks ResolvedYes at yesShares, ResolvedNo at noShares, Voided at costPaid", () => {
    const rows = buildAgentReport(
      [
        position({ pda: "P1", market: "MY", yesShares: "7000000", costPaid: "5000000" }),
        position({ pda: "P2", market: "MN", noShares: "6000000", costPaid: "5000000" }),
        position({ pda: "P3", market: "MV", yesShares: "123", costPaid: "5000000" }),
      ],
      [
        market({ pda: "MY", status: "ResolvedYes" }),
        market({ pda: "MN", status: "ResolvedNo" }),
        market({ pda: "MV", status: "Voided" }),
      ]
    );
    expect(rows.map((r) => [r.markUnits, r.pnlUnits])).toEqual([
      [7000000n, 2000000n],
      [6000000n, 1000000n],
      [5000000n, 0n],
    ]);
  });

  it("skips positions whose market is not in the cache", () => {
    const rows = buildAgentReport([position({ market: "UNKNOWN" })], [market({})]);
    expect(rows).toEqual([]);
  });
});

describe("summarizeSkips", () => {
  it("counts skip records by reason, sorted descending", () => {
    const recs: DecisionRecord[] = [
      { ts: 1, fixtureId: 1, marketPda: "A", kind: "skip", reason: "caps" },
      { ts: 2, fixtureId: 1, marketPda: "B", kind: "skip", reason: "closed" },
      { ts: 3, fixtureId: 1, marketPda: "C", kind: "skip", reason: "caps" },
      { ts: 4, fixtureId: 1, marketPda: "D", kind: "trade", tx: "T" },
    ];
    const s = summarizeSkips(recs);
    expect(s.total).toBe(3);
    expect(s.byReason).toEqual([
      ["caps", 2],
      ["closed", 1],
    ]);
  });
});

describe("extractResolveTx", () => {
  it("pulls the trailing signature from an OK detail line", () => {
    const detail =
      'OK    2vrXz4Cd statA=7 statB=8 → {"resolvedNo":{}} tx 3XpYz5wYJdagNX4rRkmiPwy1NMnhuBJiJMKjkozvuGU5Uozfjo5eUQUrDVDyETG71S1zbM7N9pXsyhTHiHydFqZN';
    expect(extractResolveTx(detail)).toBe(
      "3XpYz5wYJdagNX4rRkmiPwy1NMnhuBJiJMKjkozvuGU5Uozfjo5eUQUrDVDyETG71S1zbM7N9pXsyhTHiHydFqZN"
    );
  });

  it("returns null for FAIL/SKIP lines without a tx", () => {
    expect(extractResolveTx("FAIL  2vrXz4Cd statA=7 statB=8 — AnchorError StalePacket")).toBeNull();
    expect(extractResolveTx("SKIP  9MLfFTvk statA=1 statB=2 — statB value 0")).toBeNull();
  });
});

describe("formatters", () => {
  it("formatUnits renders base units as 2dp test-USDC", () => {
    expect(formatUnits(20400000n)).toBe("20.40");
    expect(formatUnits(-1810000n)).toBe("-1.81");
    expect(formatUnits(0n)).toBe("0.00");
  });

  it("ppmToCents rounds to whole cents", () => {
    expect(ppmToCents(500000)).toBe(50);
    expect(ppmToCents(133730)).toBe(13);
    expect(ppmToCents(866270)).toBe(87);
  });
});
