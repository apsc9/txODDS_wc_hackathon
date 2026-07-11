import { describe, it, expect } from "vitest";
import { quote, mapBuyError } from "../src/hooks/use-trade";
import type { MarketDTO } from "../src/lib/types";

// Minimal MarketDTO builder — 50/50 seeded pool by default (matches the
// dev-seeded devnet markets: poolYes = poolNo = 50_000_000, 6-decimal base
// units — see tests/fpmm.test.ts and the seeded fixture 18213979 markets).
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
    statKeyA: 1,
    statKeyB: null,
    op: null,
    comparison: "GreaterThan",
    threshold: 0,
    ...overrides,
  };
}

describe("quote (fpmm.sharesOut through the hook's math path)", () => {
  it("50/50 seeded pool: buying 5 test-USDC YES returns shares > amountIn", () => {
    const m = makeMarket();
    const q = quote(m, "YES", 5_000_000n);
    expect(q).not.toBeNull();
    expect(q!.shares > 5_000_000n).toBe(true);
    // payout is 1:1 with shares per brief
    expect(q!.payout).toBe(q!.shares);
  });

  it("same 50/50 pool: NO side quote mirrors YES side quote", () => {
    const m = makeMarket();
    const yes = quote(m, "YES", 5_000_000n)!;
    const no = quote(m, "NO", 5_000_000n)!;
    expect(no.shares).toBe(yes.shares);
  });

  it("thin pool on the bought side costs more per share (higher avg price)", () => {
    const m = makeMarket({ poolYes: "80000000", poolNo: "20000000" });
    const q = quote(m, "NO", 1_000_000n)!;
    expect(q.avgPriceCents).toBeGreaterThan(50);
  });

  it("returns null for zero or negative amountIn", () => {
    const m = makeMarket();
    expect(quote(m, "YES", 0n)).toBeNull();
    expect(quote(m, "YES", -1n)).toBeNull();
  });

  it("returns null when a pool is empty (mirrors fpmm.sharesOut)", () => {
    const m = makeMarket({ poolYes: "0", poolNo: "50000000" });
    expect(quote(m, "YES", 1_000_000n)).toBeNull();
  });
});

describe("mapBuyError", () => {
  it("maps 0x1 (insufficient funds) verbatim", () => {
    expect(mapBuyError(new Error("Transaction simulation failed: custom program error: 0x1"))).toBe(
      "Trade not placed — not enough test USDC in wallet"
    );
  });

  it("maps SlippageExceeded anchor error verbatim", () => {
    const err = {
      message: "AnchorError occurred. Error Code: SlippageExceeded. Error Number: 6003.",
      error: { errorCode: { code: "SlippageExceeded", number: 6003 } },
    };
    expect(mapBuyError(err)).toBe("Trade not placed — price moved past your slippage limit");
  });

  it("maps wallet rejection verbatim", () => {
    expect(mapBuyError(new Error("User rejected the request."))).toBe("Trade cancelled in wallet");
  });

  it("falls back to 'Trade not placed — <short message>', never a raw code alone", () => {
    const result = mapBuyError(new Error("Some unrelated RPC hiccup"));
    expect(result.startsWith("Trade not placed — ")).toBe(true);
    expect(result).not.toBe("Trade not placed — ");
    expect(result).toContain("Some unrelated RPC hiccup");
  });
});
