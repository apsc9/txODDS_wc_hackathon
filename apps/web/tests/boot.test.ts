import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

// toErrorResponse (error-copy audit, Task 17): a raw thrown Error's
// `.message` used to be forwarded to the HTTP client verbatim — fine for
// loadTxlineCreds's actionable, already-scrubbed setup copy, but for any
// other unexpected error (an RPC hiccup, a bad account fetch, ...) that
// meant leaking whatever internal detail happened to be in `.message`
// straight into the browser response. `SetupError` (src/server/txline.ts)
// marks the former case; everything else now gets generic, on-brand copy.
describe("toErrorResponse", () => {
  // The "ensureStarted" describe above dynamically imports "../src/server/boot"
  // while "../src/server/txline" is mocked (without a SetupError export) —
  // that cached module instance would otherwise leak into these tests via
  // Node's ESM module cache (vi.doUnmock alone doesn't force a re-import;
  // only a subsequent vi.resetModules() + fresh dynamic import does).
  beforeEach(() => {
    vi.resetModules();
  });

  it("forwards a SetupError's message verbatim (actionable dev-facing remedy copy)", async () => {
    const { toErrorResponse } = await import("../src/server/boot");
    const { SetupError } = await import("../src/server/txline");

    const res = toErrorResponse(new SetupError("TXLINE_API is not set. fix your .env.local"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "TXLINE_API is not set. fix your .env.local" });
  });

  it("replaces a plain Error's message with generic 500 copy, never the raw message", async () => {
    const { toErrorResponse } = await import("../src/server/boot");

    const res = toErrorResponse(new Error("ECONNREFUSED 127.0.0.1:8899 secret-internal-detail"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toMatch(/ECONNREFUSED|secret-internal-detail/);
    expect(body).toEqual({ error: "Something went wrong on our end. Try again." });
  });

  it("replaces a plain Error's message with generic 404 copy when a status is passed", async () => {
    const { toErrorResponse } = await import("../src/server/boot");

    const res = toErrorResponse(new Error("Account does not exist or has no data /Users/x/y"), 404);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Not found." });
  });
});

// loadTxlineCreds (error-copy audit, Task 17 LIVE FINDING): this used to
// interpolate the *resolved absolute* creds path into every thrown message —
// forwarded by toErrorResponse straight into the browser, leaking this
// machine's local directory layout (username, repo location). The thrown
// message now names only the developer-configured TXLINE_CREDS value, never
// the resolved path; the resolved path still goes to the server console
// (console.error) for local debugging, which never reaches the client.
describe("loadTxlineCreds path scrubbing", () => {
  const originalCreds = process.env.TXLINE_CREDS;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalCreds === undefined) delete process.env.TXLINE_CREDS;
    else process.env.TXLINE_CREDS = originalCreds;
    vi.restoreAllMocks();
  });

  it("does not leak the resolved absolute path when the creds file is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.TXLINE_CREDS = `.keys/does-not-exist-${Date.now()}.json`;

    const { loadTxlineCreds, SetupError } = await import("../src/server/txline");

    let thrown: unknown;
    try {
      loadTxlineCreds();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SetupError);
    const message = (thrown as Error).message;
    expect(message).toContain(process.env.TXLINE_CREDS);
    expect(message).not.toContain(process.cwd());
    expect(message).not.toContain(os.homedir());
  });

  it("does not leak the resolved absolute path when the creds file has malformed JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A relative TXLINE_CREDS value, same convention as
    // .env.local.example's real one — the point of this test is that the
    // thrown message names *this* relative string, not
    // path.resolve(process.cwd(), ...) of it.
    const relativeCredsPath = `tests/tmp-creds-bad-${Date.now()}.json`;
    const absolutePath = path.resolve(process.cwd(), relativeCredsPath);
    fs.writeFileSync(absolutePath, "{ not json");
    process.env.TXLINE_CREDS = relativeCredsPath;

    const { loadTxlineCreds, SetupError } = await import("../src/server/txline");

    let thrown: unknown;
    try {
      loadTxlineCreds();
    } catch (err) {
      thrown = err;
    }
    fs.rmSync(absolutePath, { force: true });

    expect(thrown).toBeInstanceOf(SetupError);
    const message = (thrown as Error).message;
    expect(message).toContain(relativeCredsPath);
    expect(message).not.toContain(process.cwd());
  });
});
