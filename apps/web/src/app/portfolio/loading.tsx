import { PortfolioSkeleton } from "@/components/skeletons";

// App Router convention file — same reasoning as src/app/(home)/loading.tsx:
// Next wraps portfolio/page.tsx in a Suspense boundary automatically when
// this file exists, using it as the fallback while that RSC segment is
// still being produced (hard reload / direct navigation).
//
// Safe to add here (unlike /fixture/[fixtureId] and /receipt/[marketPda],
// which deliberately do NOT get one — see (home)/loading.tsx's doc
// comment): portfolio/page.tsx never calls `notFound()`, so this carries
// none of that streaming-status-code risk.
export default function Loading() {
  return (
    <div>
      <h1 className="label mb-6">PORTFOLIO</h1>
      <PortfolioSkeleton />
    </div>
  );
}
