import { describe, it, expect } from "vitest";
import {
  joinPositions,
  classifyStub,
  claimAmount,
  currentValue,
  formatUsd,
  sharesLabel,
} from "../src/lib/positions";
import type { MarketDTO, PositionDTO } from "../src/lib/types";

function makeMarket(overrides: Partial<MarketDTO> = {}): MarketDTO {
  return {
    pda: "Pda1111111111111111111111111111111111111",
    creator: "Creator111111111111111111111111111111111",
    marketId: "1821397904",
    fixtureId: 18213979,
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

function makePosition(overrides: Partial<PositionDTO> = {}): PositionDTO {
  return {
    pda: "PosPda111111111111111111111111111111111",
    market: "Pda1111111111111111111111111111111111111",
    yesShares: "0",
    noShares: "0",
    costPaid: "0",
    claimed: false,
    ...overrides,
  };
}

describe("joinPositions", () => {
  it("attaches the matching live market to each position by pda", () => {
    const m = makeMarket();
    const p = makePosition({ market: m.pda });
    const joined = joinPositions([p], [m]);
    expect(joined).toEqual([{ position: p, market: m }]);
  });

  it("drops a position whose market isn't in the markets cache yet", () => {
    const p = makePosition({ market: "MissingPda11111111111111111111111111111" });
    expect(joinPositions([p], [])).toEqual([]);
  });

  it("joins multiple positions against multiple markets, preserving position order", () => {
    const m1 = makeMarket({ pda: "M1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    const m2 = makeMarket({ pda: "M2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    const p1 = makePosition({ pda: "P1", market: m1.pda });
    const p2 = makePosition({ pda: "P2", market: m2.pda });
    expect(joinPositions([p1, p2], [m2, m1])).toEqual([
      { position: p1, market: m1 },
      { position: p2, market: m2 },
    ]);
  });
});

describe("classifyStub", () => {
  it("Open market -> Open, regardless of shares/claimed", () => {
    const m = makeMarket({ status: "Open" });
    expect(classifyStub(makePosition(), m)).toBe("Open");
  });

  it("resolved + claimed -> Claimed, even if winning shares > 0", () => {
    const m = makeMarket({ status: "ResolvedYes" });
    const p = makePosition({ yesShares: "40000000", claimed: true });
    expect(classifyStub(p, m)).toBe("Claimed");
  });

  it("voided + claimed -> Claimed", () => {
    const m = makeMarket({ status: "Voided" });
    const p = makePosition({ costPaid: "25000000", claimed: true });
    expect(classifyStub(p, m)).toBe("Claimed");
  });

  it("Voided + unclaimed -> Refundable", () => {
    const m = makeMarket({ status: "Voided" });
    const p = makePosition({ costPaid: "25000000" });
    expect(classifyStub(p, m)).toBe("Refundable");
  });

  it("ResolvedYes + unclaimed + yesShares > 0 -> Claimable", () => {
    const m = makeMarket({ status: "ResolvedYes" });
    const p = makePosition({ yesShares: "40000000" });
    expect(classifyStub(p, m)).toBe("Claimable");
  });

  it("ResolvedNo + unclaimed + noShares > 0 -> Claimable", () => {
    const m = makeMarket({ status: "ResolvedNo" });
    const p = makePosition({ noShares: "12000000" });
    expect(classifyStub(p, m)).toBe("Claimable");
  });

  it("ResolvedYes + unclaimed + yesShares == 0 (only bought NO) -> Worthless", () => {
    const m = makeMarket({ status: "ResolvedYes" });
    const p = makePosition({ noShares: "12000000" });
    expect(classifyStub(p, m)).toBe("Worthless");
  });

  it("ResolvedNo + unclaimed + noShares == 0 (only bought YES) -> Worthless", () => {
    const m = makeMarket({ status: "ResolvedNo" });
    const p = makePosition({ yesShares: "12000000" });
    expect(classifyStub(p, m)).toBe("Worthless");
  });
});

describe("claimAmount (mirrors programs/fulltime/src/lib.rs's claim() match arm)", () => {
  it("ResolvedYes -> yesShares", () => {
    const m = makeMarket({ status: "ResolvedYes" });
    const p = makePosition({ yesShares: "40000000", noShares: "5000000" });
    expect(claimAmount(p, m)).toBe(40_000_000n);
  });

  it("ResolvedNo -> noShares", () => {
    const m = makeMarket({ status: "ResolvedNo" });
    const p = makePosition({ yesShares: "5000000", noShares: "40000000" });
    expect(claimAmount(p, m)).toBe(40_000_000n);
  });

  it("Voided -> costPaid", () => {
    const m = makeMarket({ status: "Voided" });
    const p = makePosition({ costPaid: "25000000" });
    expect(claimAmount(p, m)).toBe(25_000_000n);
  });

  it("Open -> 0 (no claim ix would ever be sent)", () => {
    const m = makeMarket({ status: "Open" });
    const p = makePosition({ yesShares: "40000000" });
    expect(claimAmount(p, m)).toBe(0n);
  });
});

describe("currentValue (Open-state mark-to-market)", () => {
  it("50/50 pool: 40 YES shares mark at half their face value", () => {
    const m = makeMarket({ yesPpm: 500_000 });
    const p = makePosition({ yesShares: "40000000" });
    expect(currentValue(p, m)).toBe(20_000_000n);
  });

  it("skewed pool: NO shares mark at the complement of yesPpm", () => {
    const m = makeMarket({ yesPpm: 700_000 }); // YES 70c / NO 30c
    const p = makePosition({ noShares: "10000000" });
    expect(currentValue(p, m)).toBe(3_000_000n);
  });

  it("mixed YES+NO position sums both legs", () => {
    const m = makeMarket({ yesPpm: 600_000 }); // YES 60c / NO 40c
    const p = makePosition({ yesShares: "10000000", noShares: "10000000" });
    expect(currentValue(p, m)).toBe(6_000_000n + 4_000_000n);
  });
});

describe("formatUsd", () => {
  it("formats base units (6 decimals) to a 2dp USDC string", () => {
    expect(formatUsd(40_000_000n)).toBe("40.00");
    expect(formatUsd(1_234_567n)).toBe("1.23");
    expect(formatUsd(0n)).toBe("0.00");
  });
});

describe("sharesLabel", () => {
  it("YES-only position", () => {
    expect(sharesLabel(makePosition({ yesShares: "40000000" }))).toBe("40.00 YES");
  });

  it("NO-only position", () => {
    expect(sharesLabel(makePosition({ noShares: "12000000" }))).toBe("12.00 NO");
  });

  it("mixed YES+NO position shows both", () => {
    expect(sharesLabel(makePosition({ yesShares: "5000000", noShares: "2000000" }))).toBe(
      "5.00 YES / 2.00 NO"
    );
  });

  it("empty position", () => {
    expect(sharesLabel(makePosition())).toBe("0");
  });
});
