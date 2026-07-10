import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openStream } from "../src/server/txline";

const TXLINE_API = "https://txline-test.example.com";
const originalFetch = global.fetch;

let credsPath: string;
let stops: Array<() => void>;

beforeEach(() => {
  credsPath = path.join(
    os.tmpdir(),
    `txline-creds-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
  fs.writeFileSync(credsPath, JSON.stringify({ jwt: "test-jwt", apiToken: "test-token" }));
  process.env.TXLINE_API = TXLINE_API;
  process.env.TXLINE_CREDS = credsPath;
  stops = [];
});

afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
  global.fetch = originalFetch;
  fs.rmSync(credsPath, { force: true });
  delete process.env.TXLINE_API;
  delete process.env.TXLINE_CREDS;
});

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/** A fetch() that never settles until its AbortSignal fires, mirroring real fetch abort semantics. */
function pendingUntilAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

type StreamStep =
  | { kind: "data"; chunk: string }
  | { kind: "error"; error: Error }
  | { kind: "close" };

/** Builds a real ReadableStream<Uint8Array> that plays back `steps`, then stalls forever. */
function makeSseStream(steps: StreamStep[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= steps.length) {
        return new Promise(() => {
          /* stall: simulate an idle-but-open connection */
        });
      }
      const step = steps[i++];
      if (step.kind === "data") controller.enqueue(encoder.encode(step.chunk));
      else if (step.kind === "close") controller.close();
      else if (step.kind === "error") controller.error(step.error);
    },
  });
}

describe("openStream lifecycle", () => {
  it("connects to /api/odds/stream with auth + SSE headers and delivers messages via onMsg", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      expect(url).toBe(`${TXLINE_API}/api/odds/stream`);
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer test-jwt",
        "X-Api-Token": "test-token",
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      });
      return Promise.resolve(
        new Response(
          makeSseStream([{ kind: "data", chunk: 'event: odds_update\ndata: {"a":1}\n\n' }])
        )
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const onMsg = vi.fn();
    const onDown = vi.fn();
    const stop = openStream("odds", onMsg, onDown);
    stops.push(stop);

    // flush the microtask queue (fetch resolution, stream read/decode, async
    // generator yield, for-await iteration) so connect()'s first message
    // reaches onMsg. A real macrotask boundary guarantees all microtasks
    // queued so far have drained.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onMsg).toHaveBeenCalledWith('{"a":1}', "odds_update");
    expect(onDown).not.toHaveBeenCalled();
  });

  it("reconnects after failures with exponential backoff capped at 30s", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.reject(new Error("network down")));
    global.fetch = fetchMock as unknown as typeof fetch;

    const onMsg = vi.fn();
    const onDown = vi.fn();
    const stop = openStream("odds", onMsg, onDown);
    stops.push(stop);

    // first connect attempt happens immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onDown).toHaveBeenCalledTimes(1);

    // sleep durations before each subsequent attempt: 1000,2000,4000,8000,16000,
    // then capped at 30000 (would otherwise be 32000) and stays capped.
    const expectedBackoffs = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    let expectedCalls = 1;
    for (const backoff of expectedBackoffs) {
      // just before the backoff elapses, no new attempt yet
      await vi.advanceTimersByTimeAsync(backoff - 1);
      expect(fetchMock).toHaveBeenCalledTimes(expectedCalls);
      // once it elapses, the next attempt fires
      await vi.advanceTimersByTimeAsync(1);
      expectedCalls += 1;
      expect(fetchMock).toHaveBeenCalledTimes(expectedCalls);
      expect(onDown).toHaveBeenCalledTimes(expectedCalls);
    }
  });

  it("resets backoff to 1s after a successful message, even after it had grown", async () => {
    vi.useFakeTimers();
    const behaviors: Array<() => Promise<Response>> = [
      () => Promise.reject(new Error("down1")),
      () => Promise.reject(new Error("down2")),
      () =>
        Promise.resolve(
          new Response(
            makeSseStream([
              { kind: "data", chunk: "data: hello\n\n" },
              { kind: "error", error: new Error("dropped mid-stream") },
            ])
          )
        ),
      () => Promise.reject(new Error("down3")),
    ];
    let call = 0;
    const fetchMock = vi.fn(() => behaviors[Math.min(call++, behaviors.length - 1)]());
    global.fetch = fetchMock as unknown as typeof fetch;

    const onMsg = vi.fn();
    const onDown = vi.fn();
    const stop = openStream("odds", onMsg, onDown);
    stops.push(stop);

    await vi.advanceTimersByTimeAsync(0); // call 1 fails
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000); // backoff was 1000 -> call 2 fails, backoff grows to 4000
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000); // backoff was 2000 -> call 3 succeeds, delivers message, then drops
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // let the stream's message + subsequent error propagate
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(onMsg).toHaveBeenCalledWith("hello", null);

    // if backoff had NOT reset, next attempt would be 4000ms away; it should
    // actually be back to 1000ms because onMsg fired before the drop.
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("stop() aborts the in-flight request and no further fetch calls occur", async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return pendingUntilAborted(init?.signal);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const onMsg = vi.fn();
    const onDown = vi.fn();
    const stop = openStream("odds", onMsg, onDown);
    stops.push(stop);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const signal = calls[0].init?.signal;
    expect(signal?.aborted).toBe(false);

    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(signal?.aborted).toBe(true);

    // clean shutdown: no onDown, no reconnect, even after a long wait
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onDown).not.toHaveBeenCalled();
    expect(onMsg).not.toHaveBeenCalled();
  });

  it("onDown throwing does not produce an unhandled rejection and reconnection still proceeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.reject(new Error("network down")));
    global.fetch = fetchMock as unknown as typeof fetch;

    const onMsg = vi.fn();
    const onDown = vi.fn(() => {
      throw new Error("boom from onDown");
    });

    const rejections: unknown[] = [];
    const handler = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", handler);

    try {
      const stop = openStream("odds", onMsg, onDown);
      stops.push(stop);

      await vi.advanceTimersByTimeAsync(0);
      expect(onDown).toHaveBeenCalledTimes(1);

      // reconnect still happens on schedule despite onDown throwing
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(onDown).toHaveBeenCalledTimes(2);

      // give any stray rejection a chance to surface
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    } finally {
      process.off("unhandledRejection", handler);
    }

    expect(rejections).toEqual([]);
  });
});
