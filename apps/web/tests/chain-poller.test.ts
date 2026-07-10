import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// startChainPoller()'s module-scope `globalThis.__fulltimeChainStarted` flag
// was previously set *before* `getProgram()` ran. `getProgram()` constructs
// the Anchor `Program` client and can throw synchronously (observed live as
// "Wallet is not a constructor") — with the flag set first, a throwing
// attempt would still leave the poller permanently "started" per the
// once-guard contract, so no later call would ever retry it. This test
// mocks `@coral-xyz/anchor`'s `Program` constructor to throw on its first
// call and succeed on the second, confirming the flag stays down (and the
// call remains retryable) after a throw, then goes up once `getProgram()`
// actually succeeds.
//
// The mocked `Program` stub's `account.market.all()` resolves to `[]`
// synchronously-ish (a resolved promise) so the poll loop `startChainPoller`
// schedules never makes a real RPC call.
describe("startChainPoller", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    delete (globalThis as unknown as { __fulltimeChainStarted?: boolean })
      .__fulltimeChainStarted;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.doUnmock("@coral-xyz/anchor");
  });

  it("does not set the started flag when getProgram (Program construction) throws, and succeeds + flags on retry", async () => {
    let programCallCount = 0;
    vi.doMock("@coral-xyz/anchor", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@coral-xyz/anchor")>();
      return {
        ...actual,
        Program: vi.fn().mockImplementation(() => {
          programCallCount++;
          if (programCallCount === 1) {
            throw new TypeError("Wallet is not a constructor");
          }
          return { account: { market: { all: vi.fn().mockResolvedValue([]) } } };
        }),
      };
    });

    const { startChainPoller } = await import("../src/server/chain");

    // First call: Program construction throws. The flag must stay down.
    expect(() => startChainPoller()).toThrow("Wallet is not a constructor");
    expect(
      (globalThis as unknown as { __fulltimeChainStarted?: boolean }).__fulltimeChainStarted,
    ).toBeFalsy();
    expect(programCallCount).toBe(1);

    // Second call: getProgram() retries construction from scratch (cachedProgram
    // was never set on the failed attempt) and succeeds this time -> flag goes up.
    expect(() => startChainPoller()).not.toThrow();
    expect(
      (globalThis as unknown as { __fulltimeChainStarted?: boolean }).__fulltimeChainStarted,
    ).toBe(true);
    expect(programCallCount).toBe(2);

    // Third call: now a genuine no-op — Program is not constructed again.
    startChainPoller();
    expect(programCallCount).toBe(2);
  });
});
