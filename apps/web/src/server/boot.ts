import "server-only";

import { startChainPoller } from "./chain";
import { hub } from "./feedhub";
import { loadTxlineCreds } from "./txline";

declare global {
  // eslint-disable-next-line no-var
  var __fulltimeBooted: boolean | undefined;
}

// Every API route calls this before touching hub/chain state. `hub.start()`
// and `startChainPoller()` are each idempotent on their own (module-scope
// flags in feedhub.ts / chain.ts), but this module adds its own HMR-safe
// once-guard on top so the boot sequence itself only ever runs one time per
// process, regardless of which route hits it first.
//
// `hub.start()` swallows failures from its own `fetchFixturesSnapshot()`
// call (a bad snapshot fetch must not stop the live odds/scores streams from
// starting) and `openStream`'s reconnect loop likewise never throws out to
// callers — so neither call is a reliable place to catch a stale/missing
// TxLINE creds file. `loadTxlineCreds()` is called here first, synchronously,
// purely to fail fast with Task 4's remedy copy attached to the thrown
// error. It intentionally runs *before* the guard flag is set, so a request
// made after the creds file is fixed (e.g. by re-running the auth CLI) can
// retry the whole boot sequence instead of being stuck failed forever.
export function ensureStarted(): void {
  if (globalThis.__fulltimeBooted) return;
  loadTxlineCreds();
  globalThis.__fulltimeBooted = true;
  hub.start();
  startChainPoller();
}

// Shared by every route: turns a thrown Error (notably loadTxlineCreds's
// remedy-copy errors, but any other unexpected throw too) into a JSON body
// that carries the real message, rather than a bare "Internal Server Error".
export function toErrorResponse(err: unknown, status = 500): Response {
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ error: message }, { status });
}
