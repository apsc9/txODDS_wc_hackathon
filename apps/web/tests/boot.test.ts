import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// boot.ts's `ensureStarted()` guards its module-scope `globalThis.__fulltimeBooted`
// flag. Task 7 review found the flag was set *before* `hub.start()` and
// `startChainPoller()` ran, so a synchronous throw from either (observed live
// as `startChainPoller()` -> `getProgram()` -> "Wallet is not a constructor")
// would still leave the flag permanently up: every later `ensureStarted()`
// call would short-circuit as a no-op forever, serving stale/empty 200s until
// the process restarted. These tests exercise the fixed ordering: the flag
// must stay down (and the whole boot sequence retryable) across a throwing
// attempt, and only go up once a later attempt fully succeeds.
//
// `./chain` and `./feedhub` are mocked wholesale so this only exercises
// boot.ts's own sequencing — not chain.ts's real Anchor client, which is
// covered separately in chain-poller.test.ts. `vi.resetModules()` +
// dynamic import gives each test a fresh boot.ts module (its `ensureStarted`
// closure doesn't hold any state itself, but resetting keeps mocks and the
// globalThis flag from bleeding across tests).
describe("ensureStarted", () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as unknown as { __fulltimeBooted?: boolean }).__fulltimeBooted;
  });

  afterEach(() => {
    vi.doUnmock("../src/server/txline");
    vi.doUnmock("../src/server/feedhub");
    vi.doUnmock("../src/server/chain");
    delete (globalThis as unknown as { __fulltimeBooted?: boolean }).__fulltimeBooted;
  });

  it("does not set the boot flag when startChainPoller throws, and retries the full sequence on the next call", async () => {
    const loadTxlineCreds = vi.fn();
    const hubStart = vi.fn();
    const startChainPoller = vi.fn();
    startChainPoller.mockImplementationOnce(() => {
      throw new Error("Wallet is not a constructor");
    });
    startChainPoller.mockImplementationOnce(() => {
      /* succeeds on the retry */
    });

    vi.doMock("../src/server/txline", () => ({ loadTxlineCreds }));
    vi.doMock("../src/server/feedhub", () => ({ hub: { start: hubStart } }));
    vi.doMock("../src/server/chain", () => ({ startChainPoller }));

    const { ensureStarted } = await import("../src/server/boot");

    // First call: startChainPoller throws synchronously. The flag must NOT
    // be set — a throwing boot attempt has to stay retryable.
    expect(() => ensureStarted()).toThrow("Wallet is not a constructor");
    expect(
      (globalThis as unknown as { __fulltimeBooted?: boolean }).__fulltimeBooted,
    ).toBeFalsy();
    expect(loadTxlineCreds).toHaveBeenCalledTimes(1);
    expect(hubStart).toHaveBeenCalledTimes(1);
    expect(startChainPoller).toHaveBeenCalledTimes(1);

    // Second call: the guard flag being down means the whole sequence reruns
    // from the top (loadTxlineCreds + hub.start again), not just the part
    // that failed — this call succeeds, and only now does the flag flip.
    expect(() => ensureStarted()).not.toThrow();
    expect((globalThis as unknown as { __fulltimeBooted?: boolean }).__fulltimeBooted).toBe(
      true,
    );
    expect(loadTxlineCreds).toHaveBeenCalledTimes(2);
    expect(hubStart).toHaveBeenCalledTimes(2);
    expect(startChainPoller).toHaveBeenCalledTimes(2);

    // Third call: now genuinely a no-op — nothing re-invoked once booted.
    ensureStarted();
    expect(loadTxlineCreds).toHaveBeenCalledTimes(2);
    expect(hubStart).toHaveBeenCalledTimes(2);
    expect(startChainPoller).toHaveBeenCalledTimes(2);
  });

  it("does not set the boot flag when hub.start throws, and retries on the next call", async () => {
    const loadTxlineCreds = vi.fn();
    const hubStart = vi.fn();
    hubStart.mockImplementationOnce(() => {
      throw new Error("snapshot fetch exploded");
    });
    hubStart.mockImplementationOnce(() => {
      /* succeeds on the retry */
    });
    const startChainPoller = vi.fn();

    vi.doMock("../src/server/txline", () => ({ loadTxlineCreds }));
    vi.doMock("../src/server/feedhub", () => ({ hub: { start: hubStart } }));
    vi.doMock("../src/server/chain", () => ({ startChainPoller }));

    const { ensureStarted } = await import("../src/server/boot");

    expect(() => ensureStarted()).toThrow("snapshot fetch exploded");
    expect(
      (globalThis as unknown as { __fulltimeBooted?: boolean }).__fulltimeBooted,
    ).toBeFalsy();
    // hub.start() throwing must also stop startChainPoller() from running
    // this attempt (sequential ordering: creds -> hub.start -> chain poller).
    expect(startChainPoller).not.toHaveBeenCalled();

    expect(() => ensureStarted()).not.toThrow();
    expect((globalThis as unknown as { __fulltimeBooted?: boolean }).__fulltimeBooted).toBe(
      true,
    );
    expect(startChainPoller).toHaveBeenCalledTimes(1);
  });
});
