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
} satisfies NextConfig;
