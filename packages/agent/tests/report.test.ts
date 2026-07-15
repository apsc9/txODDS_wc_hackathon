import { describe, it, expect } from "vitest";
import { buildReport, type ReportPosition } from "../src/report.js";
import type { AgentMarket } from "../src/engine.js";
import type { DecisionRecord } from "../src/log.js";

const mkt = (pda: string, over: Partial<AgentMarket> = {}): AgentMarket => ({
  pda,
  fixtureId: 18241006,
  mint: "M",
  poolYes: "40000000",
  poolNo: "60000000", // yesPpm 600000
  resolveAfterTs: 0,
  status: "Open",
  yesPpm: 600_000,
  fairPpm: null,
  ...over,
});

const pos = (market: string, over: Partial<ReportPosition> = {}): ReportPosition => ({
  market,
  yesShares: 10_000_000n,
  noShares: 0n,
  costPaid: 5_000_000n,
  claimed: false,
  ...over,
});

describe("buildReport", () => {
  it("marks open positions to pool price", () => {
    const rows = buildReport([], [pos("A")], [mkt("A")]);
    expect(rows).toHaveLength(1);
    // 10 YES shares * 0.60 = 6.0 USDC mark vs 5.0 cost → +1.0
    expect(rows[0]).toMatchObject({
      marketPda: "A",
      status: "Open",
      costUnits: 5_000_000n,
      markUnits: 6_000_000n,
      pnlUnits: 1_000_000n,
    });
  });

  it("values ResolvedYes at yes shares, ResolvedNo at no shares", () => {
    const rows = buildReport(
      [],
      [pos("A"), pos("B", { yesShares: 0n, noShares: 8_000_000n, costPaid: 3_000_000n })],
      [mkt("A", { status: "ResolvedYes" }), mkt("B", { status: "ResolvedNo" })]
    );
    expect(rows[0]).toMatchObject({ status: "ResolvedYes", markUnits: 10_000_000n, pnlUnits: 5_000_000n });
    expect(rows[1]).toMatchObject({ status: "ResolvedNo", markUnits: 8_000_000n, pnlUnits: 5_000_000n });
  });

  it("values Voided at cost (refund)", () => {
    const rows = buildReport([], [pos("A")], [mkt("A", { status: "Voided" })]);
    expect(rows[0]).toMatchObject({ markUnits: 5_000_000n, pnlUnits: 0n });
  });

  it("skips positions with no matching market (not agent-tracked)", () => {
    expect(buildReport([], [pos("ZZZ")], [mkt("A")])).toHaveLength(0);
  });
});
