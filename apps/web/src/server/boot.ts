import "server-only";

import { startChainPoller } from "./chain";
import { hub } from "./feedhub";
import { loadTxlineCreds, SetupError } from "./txline";

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
//
// The flag is likewise set *after* `hub.start()` and `startChainPoller()`
// both return, not before. `startChainPoller()` can throw synchronously
// (`getProgram()` constructing the Anchor client) — if the flag were set
// first, that throw would still leave every future `ensureStarted()` call a
// silent no-op forever (routes serving empty/stale 200s until the process
// restarts) instead of retrying on the next request, same reasoning as the
// creds check above.
export function ensureStarted(): void {
  if (globalThis.__fulltimeBooted) return;
  loadTxlineCreds();
  hub.start();
  startChainPoller();
  globalThis.__fulltimeBooted = true;
}

const GENERIC_MESSAGE: Record<number, string> = {
  404: "Not found.",
  500: "Something went wrong on our end. Try again.",
};

// Shared by every route's catch block. A `SetupError` (./txline.ts's
// loadTxlineCreds / apiBase) carries actionable, already-scrubbed copy meant
// for the developer running this locally (env var name + remedy command,
// never a resolved filesystem path — see SetupError's doc comment) and is
// forwarded verbatim.
//
// Any other error — an unexpected RPC failure, a bad Anchor account fetch,
// anything not explicitly designed to be client-facing — is logged
// server-side (so the real cause is still visible in the terminal) and
// replaced with terse, on-brand generic copy before it reaches the browser.
// Previously this forwarded every error's raw `.message` verbatim, which for
// the creds-file-missing case leaked this machine's absolute local file path
// (username + repo location) into the HTTP response — fixed by scrubbing at
// the source (SetupError) and generic-izing everything else here.
export function toErrorResponse(err: unknown, status = 500): Response {
  if (err instanceof SetupError) {
    return Response.json({ error: err.message }, { status });
  }
  console.error("[api] unhandled error:", err);
  const message = GENERIC_MESSAGE[status] ?? GENERIC_MESSAGE[500];
  return Response.json({ error: message }, { status });
}
