import "server-only";

import { ensureStarted, toErrorResponse } from "@/server/boot";
import { hub, type LiveScore } from "@/server/feedhub";

export const dynamic = "force-dynamic";

const WINDOW_BEFORE_MS = 6 * 60 * 60 * 1000;
const WINDOW_AFTER_MS = 72 * 60 * 60 * 1000;

export async function GET(): Promise<Response> {
  try {
    ensureStarted();
  } catch (err) {
    return toErrorResponse(err);
  }

  const now = Date.now();
  const lo = now - WINDOW_BEFORE_MS;
  const hi = now + WINDOW_AFTER_MS;

  // `Fixture.StartTime` is epoch milliseconds (verified against
  // data/recordings/devnet-fixtures-2026-07-10.json — 13-digit values like
  // 1784386800000, not 10-digit seconds), so the window bounds above are
  // plain millisecond arithmetic against Date.now().
  //
  // "Live" here means "currently producing score packets" (hub.scores has an
  // entry), not `LiveScore.gameState` — devnet's scores stream reports
  // GameState "scheduled" for the whole match including mid-match goal
  // events (see .superpowers/sdd/progress.md), so the string is not a
  // trustworthy live/finished signal on this feed.
  const fixtures = Array.from(hub.fixtures.values())
    .filter((f) => f.StartTime >= lo && f.StartTime <= hi)
    .sort((a, b) => {
      const aLive = hub.scores.has(a.FixtureId);
      const bLive = hub.scores.has(b.FixtureId);
      if (aLive !== bLive) return aLive ? -1 : 1;
      return a.StartTime - b.StartTime;
    });

  const scores: Record<number, LiveScore> = {};
  for (const f of fixtures) {
    const s = hub.scores.get(f.FixtureId);
    if (s) scores[f.FixtureId] = s;
  }

  return Response.json({ fixtures, scores });
}
