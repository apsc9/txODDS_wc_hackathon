import { MatchListSkeleton } from "@/components/skeletons";

// App Router convention file: Next wraps this route group's page.tsx in a
// Suspense boundary automatically when this file exists, using it as the
// fallback while that RSC segment is still being produced (hard reload /
// direct navigation) or fetched (client-side navigation into `/`).
//
// Lives in the `(home)` route group — not at the app root — specifically so
// this Suspense boundary does NOT wrap sibling routes like
// `/fixture/[fixtureId]`. When it lived at src/app/loading.tsx it wrapped
// every route (Suspense boundaries apply to all descendants unless a
// segment introduces its own), which meant `/fixture/[fixtureId]` always
// streamed: Next commits the 200 status + shell before the RSC render
// reaches that page's `notFound()` call, so unknown fixtures rendered the
// not-found UI under an already-sent 200 (bad for SEO/monitoring, verified
// live via `curl -o /dev/null -w "%{http_code}"`).
//
// The obvious-looking fix — a `generateMetadata` on the fixture page calling
// `notFound()`, which per Next's docs resolves before the streamed shell —
// does NOT work here: Next 15's streaming-metadata default (since v15.2,
// only disable-able globally via `next.config.ts`'s `htmlLimitedBots`) plus
// a confirmed upstream bug (vercel/next.js#75543, #77235: notFound() from
// generateMetadata doesn't change the status code when an ancestor
// loading.tsx is present) mean the status stays 200 regardless — verified
// empirically here with both a `generateMetadata` existence check AND
// `htmlLimitedBots: /.*/` in next.config.ts, neither changed the code while
// this loading.tsx wrapped the route. Scoping the Suspense boundary via this
// route group instead removes the streaming entirely for `/fixture/*`, so
// its existing `notFound()` calls (src/app/fixture/[fixtureId]/page.tsx)
// resolve before any bytes are sent and the status is a real 404 — no
// change needed in the fixture route at all.
export default function Loading() {
  return (
    <div>
      <h1 className="label mb-6">MATCHES</h1>
      <MatchListSkeleton />
    </div>
  );
}
