"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--bg)] px-6">
      <div className="max-w-sm text-center">
        <h1 className="font-display text-3xl font-bold text-[var(--chalk)] mb-3">
          FEED INTERRUPTED
        </h1>
        <p className="text-[var(--t3)] mb-8 text-sm">
          Live feed temporarily unavailable. Try again in a moment.
        </p>
        <button
          onClick={() => reset()}
          className="px-6 py-2 border border-[var(--line-hi)] bg-transparent text-[var(--chalk)] font-mono text-xs rounded hover:bg-[var(--surface-hi)] hover:border-[var(--gold)] transition-colors"
        >
          RETRY
        </button>
      </div>
    </div>
  );
}
