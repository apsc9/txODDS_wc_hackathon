import { notFound } from "next/navigation";
import { ensureStarted } from "@/server/boot";
import { hub } from "@/server/feedhub";
import { MarketBoard } from "@/components/market-row";
import { deepestPool } from "@/lib/match-list";
import type { LiveScore } from "@/lib/types";

// Same reasoning as `/` (src/app/page.tsx): this page's output depends on
// live, in-memory hub state, so it must never be statically rendered.
export const dynamic = "force-dynamic";

export default async function FixturePage({
  params,
}: {
  params: Promise<{ fixtureId: string }>;
}) {
  ensureStarted();

  const { fixtureId: fixtureIdParam } = await params;
  const fixtureId = Number(fixtureIdParam);
  if (!Number.isInteger(fixtureId)) notFound();

  const fixture = hub.fixtures.get(fixtureId);
  if (!fixture) notFound();

  const score = hub.scores.get(fixtureId);
  const scores: Record<number, LiveScore> = score ? { [fixtureId]: score } : {};
  const markets = Array.from(hub.marketCache.values()).filter((m) => m.fixtureId === fixtureId);

  // PriceChart (mounted inside MarketBoard) shows the same deepest-pool
  // market MarketBoard itself defaults `selected` to — reading its history
  // straight off the hub here (no HTTP round trip, same posture as
  // fixture/scores/markets above) means that chart's first paint carries
  // real data instead of an empty shell. Goals are keyed by fixtureId, not
  // pda, so those don't need the same guard.
  const defaultMarket = deepestPool(markets);
  const history = defaultMarket ? (hub.history.get(defaultMarket.pda) ?? []) : [];
  const goals = hub.goalEvents.get(fixtureId) ?? [];

  // MarketBoard owns the two-column grid itself (left: scorebug + market
  // rows, right: sticky rail) since the rail's trade slip needs the client
  // `selected`/`side` state that lives inside it — see
  // src/components/market-row.tsx.
  return (
    <MarketBoard
      fixtureId={fixtureId}
      initialFeedUp={hub.feedUp}
      initial={{ fixture, scores, markets, history, goals }}
    />
  );
}
