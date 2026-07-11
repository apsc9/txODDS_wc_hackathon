import path from "node:path";
import type { NextConfig } from "next";

export default {
  // `@coral-xyz/anchor` is a CJS package whose named exports (e.g. `Wallet`)
  // don't survive Next's webpack CJS/ESM interop when bundled for the server
  // — `new anchor.Wallet(...)` throws "Wallet is not a constructor" at
  // request time in server/chain.ts. Excluding it from bundling makes the
  // server runtime `require()` it directly via Node instead, which resolves
  // named exports correctly (verified: same package works fine under plain
  // `node -e "require('@coral-xyz/anchor').Wallet"`).
  serverExternalPackages: ["@coral-xyz/anchor"],
  // Out-of-brief fix (Task 11): Next was auto-detecting the workspace root
  // as the nearest ancestor directory with a lockfile — an unrelated, stray
  // /Users/<home>/package-lock.json outside this repo entirely — instead of
  // apps/web (dev server printed exactly this warning). With the root
  // mis-pinned, any *new* dynamic App Router segment (verified with both
  // this task's src/app/fixture/[fixtureId] and a disposable throwaway
  // [id] route) 500'd on first load: dev's static-paths-worker child
  // process resolved `.next/server/vendor-chunks/@solana*.js` against the
  // wrong root and threw MODULE_NOT_FOUND, even though the chunk existed on
  // disk under apps/web/.next. Existing routes (no dynamic segments) were
  // unaffected, which is why this wasn't caught before Task 11. Pinning the
  // root explicitly removes the ambiguity.
  outputFileTracingRoot: path.join(__dirname),
} satisfies NextConfig;
