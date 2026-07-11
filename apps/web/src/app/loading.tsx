import { MatchListSkeleton } from "@/components/skeletons";

// App Router convention file: Next wraps src/app/page.tsx in a Suspense
// boundary automatically when this file exists, using it as the fallback
// while that RSC segment is still being produced (hard reload / direct
// navigation) or fetched (client-side navigation into `/`).
export default function Loading() {
  return (
    <div>
      <h1 className="label mb-6">MATCHES</h1>
      <MatchListSkeleton />
    </div>
  );
}
