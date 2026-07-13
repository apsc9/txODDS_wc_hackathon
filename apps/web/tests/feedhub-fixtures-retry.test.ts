import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Fixture } from "../src/server/txline";

// hub.start()'s fetchFixturesSnapshot() call must retry (with backoff, same
// posture as openStream's reconnect loop) until it first succeeds — a boot
// during a TxLINE blip otherwise leaves hub.fixtures empty for the whole
// process lifetime: home says "No fixtures in range right now" and every
// fixture page 404s, while the odds/scores streams reconnect happily.
//
// txline is mocked wholesale (streams are covered by openstream.test.ts);
// the global hub singleton is rebuilt fresh per test via the
// globalThis.__fulltimeHub delete + vi.resetModules() dance.
vi.mock("../src/server/txline", () => ({
  fetchFixturesSnapshot: vi.fn(),
  openStream: vi.fn(() => () => {}),
}));

function mkFixture(fixtureId: number): Fixture {
  return {
    FixtureId: fixtureId,
    StartTime: 0,
    Participant1: "Spain",
    Participant2: "Belgium",
    Participant1IsHome: true,
    Competition: "Friendlies",
  };
}

describe("hub.start() fixtures snapshot retry", () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as { __fulltimeHub?: unknown }).__fulltimeHub;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { __fulltimeHub?: unknown }).__fulltimeHub;
  });

  it("retries a failed snapshot with backoff until the first success, then stops retrying", async () => {
    const txline = await import("../src/server/txline");
    const fetchMock = vi.mocked(txline.fetchFixturesSnapshot);
    // vi.mock factories are cached per file, so the same spy instance is
    // shared across tests — wipe calls + queued implementations each time.
    fetchMock.mockReset();
    fetchMock
      .mockRejectedValueOnce(new Error("TxLINE GET /api/fixtures/snapshot failed: 502 Bad Gateway"))
      .mockRejectedValueOnce(new Error("TxLINE GET /api/fixtures/snapshot failed: 502 Bad Gateway"))
      .mockResolvedValue([mkFixture(18202701)]);

    const { hub } = await import("../src/server/feedhub");
    hub.start();

    // First attempt fires immediately and rejects.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hub.fixtures.size).toBe(0);

    // First retry after the initial 1s backoff — rejects again.
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hub.fixtures.size).toBe(0);

    // Second retry after a doubled 2s backoff — succeeds, fixtures populate.
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(hub.fixtures.get(18202701)?.Participant1).toBe("Spain");

    // After the first success: no more snapshot calls, ever.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("caps the retry backoff at 30s (mirrors openStream's cap)", async () => {
    const txline = await import("../src/server/txline");
    const fetchMock = vi.mocked(txline.fetchFixturesSnapshot);
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error("down hard"));

    const { hub } = await import("../src/server/feedhub");
    hub.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Backoff sequence 1s, 2s, 4s, 8s, 16s, 30s, 30s, ... — after a long
    // outage the cadence must settle at one attempt per 30s, not keep
    // doubling toward never-retrying.
    await vi.advanceTimersByTimeAsync(61_000); // covers 1+2+4+8+16+30
    const callsAfterOutage = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls.length).toBe(callsAfterOutage + 1);
  });
});
