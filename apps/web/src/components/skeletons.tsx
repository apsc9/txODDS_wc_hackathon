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
