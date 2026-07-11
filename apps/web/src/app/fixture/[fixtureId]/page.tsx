import { notFound } from "next/navigation";
import { ensureStarted } from "@/server/boot";
import { hub } from "@/server/feedhub";
import { MarketBoard } from "@/components/market-row";
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

  return (
    <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[1fr_320px]">
      <MarketBoard
        fixtureId={fixtureId}
        initialFeedUp={hub.feedUp}
        initial={{ fixture, scores, markets }}
      />

      {/* Rail placeholder — buy slip / more-fixtures / positions land in a
          later task (Task 12/13 per the brief). */}
      <aside className="border border-[var(--line)] bg-[var(--surface)] p-4">
        <h2 className="label mb-2">TRADE</h2>
        <p className="text-xs text-[var(--t4)]">Buy slip coming soon.</p>
      </aside>
    </div>
  );
}
