import Link from "next/link";

export function SiteNav() {
  return (
    <nav className="border-b border-[var(--line)] sticky top-0 z-50 bg-[var(--bg)]">
      <div className="flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-1">
          <span className="font-display text-2xl font-bold text-[var(--chalk)]">
            FULL
          </span>
          <span className="font-display text-2xl font-bold text-[var(--gold)]">
            TIME
          </span>
        </Link>

        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="text-[var(--t3)] hover:text-[var(--t2)] transition-colors"
          >
            Matches
          </Link>
          <Link
            href="/portfolio"
            className="text-[var(--t3)] hover:text-[var(--t2)] transition-colors"
          >
            Portfolio
          </Link>
        </div>

        <div className="flex-1" />

        <span className="text-[var(--t4)] text-sm">
          {/* Wallet button placeholder for future task */}
        </span>
      </div>
    </nav>
  );
}
