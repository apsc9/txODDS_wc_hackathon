import "server-only";

import { ensureStarted, toErrorResponse } from "@/server/boot";
import { hub, type HubEvent, type LiveScore } from "@/server/feedhub";
import type { MarketDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;
const encoder = new TextEncoder();

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Fresh payload per HubEvent type, read from the hub at emit time (never the
// evt object itself, which only carries an id) — the SSE contract per the
// brief: score -> LiveScore, price -> latest PricePoint merged with pda,
// markets -> all MarketDTOs, feed -> {up}.
function freshPayload(evt: HubEvent): unknown {
  switch (evt.type) {
    case "score":
      return hub.scores.get(evt.fixtureId) ?? null;
    case "price": {
      const points = hub.history.get(evt.marketPda);
      const latest = points && points.length > 0 ? points[points.length - 1] : null;
      return latest ? { pda: evt.marketPda, ...latest } : { pda: evt.marketPda };
    }
    case "markets": {
      const markets: MarketDTO[] = Array.from(hub.marketCache.values());
      return { markets };
    }
    case "feed":
      return { up: evt.up };
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    ensureStarted();
  } catch (err) {
    return toErrorResponse(err);
  }

  // Lifted above start()/cancel() so both underlying-source hooks — and the
  // request.signal "abort" listener — close over the same mutable state
  // instead of each hook only being able to tear down what it created.
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  function cleanup(controller: ReadableStreamDefaultController<Uint8Array>): void {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe?.();
    try {
      controller.close();
    } catch {
      // already closed/errored — nothing left to do
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // controller.enqueue() throws once the stream is closed (e.g. the
      // client disconnected between two events) — that's the exact failure
      // mode feedhub's listener isolation protects the ingest loop from, but
      // this route still needs to not blow up on it, and to unsubscribe /
      // stop the heartbeat promptly rather than leaking a listener that
      // enqueues into a dead stream forever.
      function safeEnqueue(chunk: string): void {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup(controller);
        }
      }

      const scoresSnapshot: Record<number, LiveScore> = {};
      for (const [fixtureId, score] of hub.scores) {
        scoresSnapshot[fixtureId] = score;
      }
      // `markets` rides along in the snapshot (additive field — old clients
      // ignore it) so an EventSource reconnect replaces the client's
      // ["markets"] cache with authoritative server state: reconnects replay
      // this frame, never the `markets` diffs missed while disconnected,
      // and the next markets-changed diff is unbounded on a quiet feed.
      const marketsSnapshot: MarketDTO[] = Array.from(hub.marketCache.values());
      safeEnqueue(
        sseFrame("snapshot", {
          scores: scoresSnapshot,
          feedUp: hub.feedUp,
          markets: marketsSnapshot,
        }),
      );

      unsubscribe = hub.subscribe((evt) => {
        safeEnqueue(sseFrame(evt.type, freshPayload(evt)));
      });

      heartbeat = setInterval(() => {
        safeEnqueue(": heartbeat\n\n");
      }, HEARTBEAT_MS);

      // If the request was already aborted by the time this callback runs,
      // the "abort" event has already fired and a listener added now would
      // never see it — leaking the subscription + heartbeat interval
      // forever. Run the same teardown immediately in that case instead of
      // waiting on an event that isn't coming.
      if (request.signal.aborted) {
        cleanup(controller);
      } else {
        request.signal.addEventListener("abort", () => cleanup(controller));
      }
    },
    cancel() {
      // Reader-initiated cancel (distinct from request.signal abort, e.g. a
      // client that closes its own read side) needs the same teardown so
      // the hub listener/heartbeat timer never outlives its stream. Doesn't
      // call controller.close() here — a cancelled stream's controller is
      // already gone; just stop the timer/subscription side effects.
      //
      // Guarded the same way `cleanup()` is: cancel() and the abort listener
      // can both fire for the same disconnect (reader cancel *and*
      // request.signal abort), and without this guard the second call would
      // run `unsubscribe?.()` again — harmless on its own (Set#delete of an
      // already-removed entry), but it's the same double-teardown hazard
      // `cleanup()` already guards against, so cancel() should too.
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
