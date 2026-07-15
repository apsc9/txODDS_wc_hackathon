import { describe, it, expect } from "vitest";
import { decide, DEFAULT_CONFIG, type AgentMarket, type MarketRuntime } from "../src/engine.js";

const NOW_MS = 1_784_140_000_000; // some fixed instant
const NOW_SEC = NOW_MS / 1000;

function market(over: Partial<AgentMarket> = {}): AgentMarket {
  return {
    pda: "MktPda1111111111111111111111111111111111111",
    fixtureId: 18241006,
    mint: "Mint111111111111111111111111111111111111111",
    poolYes: "50000000",
    poolNo: "50000000", // 50/50 pool → yesPpm 500000
    resolveAfterTs: NOW_SEC + 3600, // closes in an hour
    status: "Open",
    yesPpm: 500_000,
    fairPpm: 700_000, // +20 pts edge, well past 5-pt threshold
    ...over,
  };
}

const freshRt: MarketRuntime = { exposureUnits: 0n, lastTradeMs: 0 };

describe("decide — guards", () => {
  it("skips non-Open market", () => {
    const d = decide(market({ status: "ResolvedYes" }), freshRt, 0n, NOW_MS, DEFAULT_CONFIG);
    expect(d).toEqual({ kind: "skip", reason: "not-open", edgePpm: null });
  });

  it("skips null fairPpm", () => {
    const d = decide(market({ fairPpm: null }), freshRt, 0n, NOW_MS, DEFAULT_CONFIG);
    expect(d).toEqual({ kind: "skip", reason: "no-fair", edgePpm: null });
  });

  it("skips inside the close buffer (TradingClosed mirror)", () => {
    const m = market({ resolveAfterTs: NOW_SEC + DEFAULT_CONFIG.closeBufferSecs - 1 });
    const d = decide(m, freshRt, 0n, NOW_MS, DEFAULT_CONFIG);
    expect(d.kind).toBe("skip");
    expect((d as any).reason).toBe("closed");
  });

  it("skips edge exactly at threshold (strict >)", () => {
    const m = market({ fairPpm: 500_000 + DEFAULT_CONFIG.edgeThresholdPpm });
    const d = decide(m, freshRt, 0n, NOW_MS, DEFAULT_CONFIG);
    expect(d).toEqual({ kind: "skip", reason: "small-edge", edgePpm: DEFAULT_CONFIG.edgeThresholdPpm });
  });

  it("skips during cooldown", () => {
    const rt: MarketRuntime = { exposureUnits: 0n, lastTradeMs: NOW_MS - DEFAULT_CONFIG.cooldownMs + 1 };
    const d = decide(market(), rt, 0n, NOW_MS, DEFAULT_CONFIG);
    expect(d.kind).toBe("skip");
    expect((d as any).reason).toBe("cooldown");
  });

  it("skips when per-market cap exhausted", () => {
    const rt: MarketRuntime = { exposureUnits: DEFAULT_CONFIG.maxPerMarketUnits, lastTradeMs: 0 };
    const d = decide(market(), rt, 0n, NOW_MS, DEFAULT_CONFIG);
    expect(d.kind).toBe("skip");
    expect((d as any).reason).toBe("caps");
  });

  it("skips when global cap exhausted", () => {
    const d = decide(market(), freshRt, DEFAULT_CONFIG.globalCapUnits, NOW_MS, DEFAULT_CONFIG);
    expect(d.kind).toBe("skip");
    expect((d as any).reason).toBe("caps");
  });
});

describe("decide — trades", () => {
  it("buys YES when fair above pool, full size at big edge", () => {
    // edge +200000 ppm ≥ full-size knee → amount = maxPerTradeUnits
    const d = decide(market({ fairPpm: 700_000 }), freshRt, 0n, NOW_MS, DEFAULT_CONFIG);
    expect(d.kind).toBe("trade");
    const t = d as Extract<typeof d, { kind: "trade" }>;
    expect(t.side).toBe("YES");
    expect(t.edgePpm).toBe(200_000);
    expect(t.amountInUnits).toBe(DEFAULT_CONFIG.maxPerTradeUnits);
    // 50/50 pools of 50 USDC, buy 5 USDC: sharesOut(50e6, 50e6, 5e6)
    // k=2.5e15, newOther=55e6, newThisMin=ceil(2.5e15/55e6)=45454546, out=50e6+5e6-45454546=9545454
    expect(t.quotedShares).toBe(9_545_454n);
    // minSharesOut = quoted * (1e6 - 20000) / 1e6 = 9545454*980000/1000000 = 9354544 (floor)
    expect(t.minSharesOut).toBe(9_354_544n);
  });

  it("buys NO when fair below pool", () => {
    const d = decide(market({ fairPpm: 300_000 }), freshRt, 0n, NOW_MS, DEFAULT_CONFIG);
    expect(d.kind).toBe("trade");
    expect((d as any).side).toBe("NO");
    expect((d as any).edgePpm).toBe(-200_000);
  });

  it("scales size down proportionally for small edges", () => {
    // edge 100000 = half of the 200000 full-size knee → 2.5 USDC
    const d = decide(market({ fairPpm: 600_000 }), freshRt, 0n, NOW_MS, DEFAULT_CONFIG);
    expect(d.kind).toBe("trade");
    expect((d as any).amountInUnits).toBe(2_500_000n);
  });

  it("floors size at 1 USDC", () => {
    // edge 51000 → proportional 5e6*51000/200000 = 1275000 > floor, so use edge 50001-ish:
    // use custom cfg with bigger knee to force sub-floor proportional size
    const cfg = { ...DEFAULT_CONFIG, edgeThresholdPpm: 10_000 };
    const d = decide(market({ fairPpm: 511_000 }), freshRt, 0n, NOW_MS, cfg);
    // proportional = 5e6 * 11000/200000 = 275000 → floored to 1_000_000
    expect(d.kind).toBe("trade");
    expect((d as any).amountInUnits).toBe(1_000_000n);
  });

  it("clamps size to remaining per-market budget", () => {
    const rt: MarketRuntime = { exposureUnits: DEFAULT_CONFIG.maxPerMarketUnits - 2_000_000n, lastTradeMs: 0 };
    const d = decide(market(), rt, 0n, NOW_MS, DEFAULT_CONFIG);
    expect(d.kind).toBe("trade");
    expect((d as any).amountInUnits).toBe(2_000_000n);
  });

  it("clamps size to remaining global budget", () => {
    const d = decide(market(), freshRt, DEFAULT_CONFIG.globalCapUnits - 1_500_000n, NOW_MS, DEFAULT_CONFIG);
    expect(d.kind).toBe("trade");
    expect((d as any).amountInUnits).toBe(1_500_000n);
  });

  it("skips caps when remaining budget under the 1 USDC floor", () => {
    const d = decide(market(), freshRt, DEFAULT_CONFIG.globalCapUnits - 999_999n, NOW_MS, DEFAULT_CONFIG);
    expect(d.kind).toBe("skip");
    expect((d as any).reason).toBe("caps");
  });

  it("skips no-quote when pool empty", () => {
    const d = decide(market({ poolYes: "0" }), freshRt, 0n, NOW_MS, DEFAULT_CONFIG);
    expect(d.kind).toBe("skip");
    expect((d as any).reason).toBe("no-quote");
  });
});
