// Loading placeholders shown by src/app/(home)/loading.tsx (App Router's
// automatic Suspense fallback for src/app/(home)/page.tsx) — i.e. before the real,
// hub-backed match list has rendered. `animate-pulse` is a plain Tailwind
// utility; globals.css's `prefers-reduced-motion` rule already disables all
// animations/transitions globally, so this respects that without any extra
// handling here.

function FixtureCardSkeleton() {
  return (
    <div
      className="flex items-center gap-4 border border-[var(--line)] bg-[var(--surface)] px-4 py-3 animate-pulse"
      aria-hidden="true"
    >
      <div className="h-5 w-5 rounded-full bg-[var(--line-hi)]" />
      <div className="h-4 w-10 rounded bg-[var(--line-hi)]" />
      <div className="h-6 w-14 rounded bg-[var(--line-hi)]" />
      <div className="h-4 w-10 rounded bg-[var(--line-hi)]" />
      <div className="h-5 w-5 rounded-full bg-[var(--line-hi)]" />
      <div className="flex-1" />
      <div className="h-4 w-16 rounded bg-[var(--line-hi)]" />
      <div className="h-4 w-12 rounded bg-[var(--line-hi)]" />
      <div className="h-4 w-14 rounded bg-[var(--line-hi)]" />
    </div>
  );
}

function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <FixtureCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function MatchListSkeleton() {
  return (
    <div className="flex flex-col gap-8" role="status" aria-label="Loading matches">
      <SectionSkeleton rows={2} />
      <SectionSkeleton rows={3} />
      <SectionSkeleton rows={2} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PortfolioSkeleton — shown by src/components/portfolio-view.tsx while
// usePositions()'s `/api/positions?owner=` fetch is in flight (a genuine
// client-side loading state: positions have no SSE channel and no RSC seed,
// unlike fixtures/scores/markets — see use-positions.ts's doc comment), and
// by src/app/portfolio/loading.tsx for the RSC segment itself.
//
// Investigated and deliberately NOT added here: MarketRow/PriceChart/
// TradeSlip skeletons. The fixture page (src/app/fixture/[fixtureId]/
// page.tsx) reads fixture/scores/markets/history/goals straight off the
// server-side hub and passes them as `initial` props that seed the
// client caches synchronously (`initialData`, staleTime: Infinity — see
// src/hooks/use-markets.ts, src/hooks/use-history.ts) — there is no
// client fetch, hence no loading gap, for the common case those three
// components render in. PriceChart and TradeSlip also already degrade to
// their exact final chrome (gridlines/toggle, full slip shell) when data is
// momentarily sparse, so a skeleton there would just be dead code sitting
// beside an already-zero-CLS empty state. Same reasoning covers the trade
// slip's MAX chip: its label is static text, never conditionally rendered
// on the async ATA balance fetch, so there is nothing to skeletonize.
//
// TicketStub's real markup: `.perf-edge-top` chalk-dim card, p-4, a
// fixture-link line (11px, bold) + predicate line (11px) + shares line
// (10px) on the left, a detail node (button/value, ~24px tall) on the
// right — mirrored here at the same sizes so the swap-in causes zero CLS.
function TicketStubSkeleton() {
  return (
    <div
      className="perf-edge-top relative flex items-start justify-between gap-3 p-4 animate-pulse"
      style={{ background: "var(--chalk-dim)" }}
      aria-hidden="true"
    >
      <div className="min-w-0 flex-1">
        <div className="h-[11px] w-28 rounded-sm" style={{ background: "#ccc" }} />
        <div className="mt-2 h-[11px] w-44 rounded-sm" style={{ background: "#ccc" }} />
        <div className="mt-1.5 h-[10px] w-20 rounded-sm" style={{ background: "#d9d6cc" }} />
      </div>
      <div className="h-6 w-20 shrink-0 rounded-sm" style={{ background: "#ccc" }} />
    </div>
  );
}

export function PortfolioSkeleton() {
  return (
    <div
      className="flex max-w-lg flex-col gap-4"
      role="status"
      aria-label="Loading positions"
    >
      {Array.from({ length: 3 }, (_, i) => (
        <TicketStubSkeleton key={i} />
      ))}
    </div>
  );
}
