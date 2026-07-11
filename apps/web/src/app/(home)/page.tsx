import { ensureStarted } from "@/server/boot";
import { hub } from "@/server/feedhub";
import { MatchList } from "@/components/match-list";
import { FIXTURE_WINDOW_AFTER_MS, FIXTURE_WINDOW_BEFORE_MS } from "@/lib/match-list";
import type { LiveScore } from "@/lib/types";

// Same reasoning as every /api/* route: this page's output depends on
// live, in-memory hub state that changes between requests, so it must never
// be statically rendered/cached by Next — a stale build-time snapshot would
// defeat the entire point of the live match list.
export const dynamic = "force-dynamic";

export default async function Home() {
  ensureStarted();

  const now = Date.now();
  const lo = now - FIXTURE_WINDOW_BEFORE_MS;
  const hi = now + FIXTURE_WINDOW_AFTER_MS;

  // Reads the hub directly (no HTTP call to our own /api/fixtures) per the
  // brief, but applies the exact same window that route uses — see
  // src/lib/match-list.ts's FIXTURE_WINDOW_* comment.
  const fixtures = Array.from(hub.fixtures.values()).filter(
    (f) => f.StartTime >= lo && f.StartTime <= hi
  );

  const scores: Record<number, LiveScore> = {};
  for (const f of fixtures) {
    const s = hub.scores.get(f.FixtureId);
    if (s) scores[f.FixtureId] = s;
  }

  const markets = Array.from(hub.marketCache.values());

  return (
    <div>
      <h1 className="label mb-6">MATCHES</h1>
      <MatchList initial={{ fixtures, scores, markets }} />
    </div>
  );
}
