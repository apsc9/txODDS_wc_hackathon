import { describe, it, expect, afterEach, vi } from "vitest";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { toMarketDTO, scheduleChainPolling } from "../src/server/chain";

// A hand-built account shaped exactly like what Anchor's BorshAccountsCoder
// hands back for a `Market` account: pubkeys as `PublicKey`, u64s as `BN`,
// Rust enums as single-key objects keyed by the camelCase variant name
// (`{ greaterThan: {} }`, `{ open: {} }`) — see target/idl/fulltime.json.
const CREATOR = new PublicKey("11111111111111111111111111111111");
const MINT = new PublicKey("So11111111111111111111111111111111111111112");
const ORACLE_PROGRAM = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const PDA = "MarketPda1111111111111111111111111111111";

function baseAccount(overrides: Record<string, unknown> = {}) {
  return {
    creator: CREATOR,
    marketId: new BN(42),
    fixtureId: new BN(18202701),
    statKeyA: 1,
    statKeyB: 2,
    op: { add: {} },
    comparison: { greaterThan: {} },
    threshold: 2,
    mint: MINT,
    oracleProgram: ORACLE_PROGRAM,
    poolYes: new BN(3_000_000),
    poolNo: new BN(1_000_000),
    seedLiquidity: new BN(2_000_000),
    resolveAfterTs: new BN(1_783_435_000),
    finalityDelaySecs: 60,
    voidAfterTs: new BN(1_783_440_000),
    status: { open: {} },
    bump: 254,
    vaultBump: 253,
    ...overrides,
  };
}

describe("toMarketDTO", () => {
  it("maps a full account: enum decode, u64->string, and yesPpm calc", () => {
    const dto = toMarketDTO(PDA, baseAccount());

    expect(dto).toEqual({
      pda: PDA,
      creator: CREATOR.toString(),
      marketId: "42",
      fixtureId: 18202701,
      statKeyA: 1,
      statKeyB: 2,
      op: "Add",
      comparison: "GreaterThan",
      threshold: 2,
      mint: MINT.toString(),
      poolYes: "3000000",
      poolNo: "1000000",
      seedLiquidity: "2000000",
      resolveAfterTs: 1_783_435_000,
      finalityDelaySecs: 60,
      voidAfterTs: 1_783_440_000,
      status: "Open",
      // impliedProbPpm(poolYes, poolNo) = poolNo * 1e6 / (poolYes+poolNo)
      //                                  = 1_000_000 * 1e6 / 4_000_000 = 250_000
      yesPpm: 250_000,
      // toMarketDTO is a pure account decode — consensus fair is filled in
      // by chain.ts's poll() afterward, not here (see fairPpm's doc comment
      // in lib/types.ts).
      fairPpm: null,
    });
  });

  it("decodes a null op/statKeyB (single-leg predicate) and other enum variants", () => {
    const dto = toMarketDTO(
      PDA,
      baseAccount({
        statKeyB: null,
        op: null,
        comparison: { lessThan: {} },
        status: { resolvedNo: {} },
      }),
    );

    expect(dto.statKeyB).toBeNull();
    expect(dto.op).toBeNull();
    expect(dto.comparison).toBe("LessThan");
    expect(dto.status).toBe("ResolvedNo");
  });

  it("decodes the remaining status/comparison enum variants", () => {
    expect(toMarketDTO(PDA, baseAccount({ status: { resolvedYes: {} } })).status).toBe(
      "ResolvedYes",
    );
    expect(toMarketDTO(PDA, baseAccount({ status: { voided: {} } })).status).toBe("Voided");
    expect(
      toMarketDTO(PDA, baseAccount({ comparison: { equalTo: {} } })).comparison,
    ).toBe("EqualTo");
    expect(toMarketDTO(PDA, baseAccount({ op: { subtract: {} } })).op).toBe("Subtract");
  });

  it("falls back to yesPpm: 0 for an empty pool (impliedProbPpm returns null)", () => {
    const dto = toMarketDTO(
      PDA,
      baseAccount({ poolYes: new BN(0), poolNo: new BN(0) }),
    );
    expect(dto.yesPpm).toBe(0);
  });
});

describe("scheduleChainPolling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never starts a second poll while the first is still in flight, and resumes after it settles", async () => {
    vi.useFakeTimers();

    // Simulates a slow getProgramAccounts call: the first poll takes 5s to
    // settle while the polling cadence is 2s, so — if ticks were scheduled
    // on a fixed setInterval grid — a naive implementation would fire a
    // second (overlapping) poll at the 2s and 4s marks before the first one
    // has even resolved.
    let resolveFirst!: () => void;
    let inFlight = 0;
    let maxConcurrent = 0;
    const runOnce = vi.fn(() => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      const call = runOnce.mock.calls.length;
      return new Promise<void>((resolve) => {
        if (call === 1) {
          resolveFirst = () => {
            inFlight--;
            resolve();
          };
        } else {
          inFlight--;
          resolve();
        }
      });
    });

    scheduleChainPolling(runOnce, 2000);

    // First poll starts immediately.
    expect(runOnce).toHaveBeenCalledTimes(1);

    // Advance well past two full cadence intervals (4s) while the first
    // poll (5s) is still pending — a second poll must NOT start.
    await vi.advanceTimersByTimeAsync(2000);
    expect(runOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(runOnce).toHaveBeenCalledTimes(1);

    // Now the slow first poll finally settles (at the simulated 5s mark).
    resolveFirst();
    await vi.advanceTimersByTimeAsync(0); // let the .finally() reschedule run

    // The next tick isn't scheduled until POLL_INTERVAL_MS *after* settling,
    // not from the original start time.
    await vi.advanceTimersByTimeAsync(1999);
    expect(runOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(runOnce).toHaveBeenCalledTimes(2);

    expect(maxConcurrent).toBe(1); // never overlapped
  });

  it("keeps polling after a rejected poll (outage survival)", async () => {
    vi.useFakeTimers();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const runOnce = vi
      .fn()
      .mockRejectedValueOnce(new Error("rpc down"))
      .mockResolvedValue(undefined);

    scheduleChainPolling(runOnce, 2000);
    await vi.advanceTimersByTimeAsync(0); // let the rejection settle

    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith("chain: poll failed", expect.any(Error));

    await vi.advanceTimersByTimeAsync(2000);
    expect(runOnce).toHaveBeenCalledTimes(2);

    errSpy.mockRestore();
  });
});
