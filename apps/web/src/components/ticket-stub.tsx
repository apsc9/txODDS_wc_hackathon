"use client";

import { useState } from "react";
import Link from "next/link";
import type { MarketDTO, PositionDTO } from "@/lib/types";
import { predicateMono } from "@/lib/statkeys";
import { classifyStub, claimAmount, currentValue, formatUsd, sharesLabel } from "@/lib/positions";
import { mapClaimError, useClaim } from "@/hooks/use-positions";

// ---------------------------------------------------------------------------
// TicketStub — chalk-dim (var(--chalk-dim)) position stub, `.perf-edge-top`
// perforated (same "torn from a chalk slip" DNA as trade-slip.tsx /
// receipt-chain.tsx, one shade dimmer — the mockup's "your ticket(s)" rail
// widget: .superpowers/brainstorm/20358-1783435793/content/fixture-page-v3.html
// / -v4.html). Two layouts sharing the same state logic:
//   - full (default): the portfolio page's card — predicate, shares, and a
//     state-specific detail line, own perforated card per ticket.
//   - compact: the fixture-page rail's "YOUR TICKETS" slot (MarketBoard in
//     market-row.tsx) — one dense row per ticket, no card chrome of its own
//     (the rail section around it supplies the perforation once).
// ---------------------------------------------------------------------------

type TxState = "idle" | "confirming" | "placed" | "error";

export type TicketStubProps = {
  p: PositionDTO;
  m: MarketDTO;
  compact?: boolean;
};

export function TicketStub({ p, m, compact = false }: TicketStubProps) {
  const claim = useClaim();
  const [txState, setTxState] = useState<TxState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const state = classifyStub(p, m);
  const shares = sharesLabel(p);
  const predicate = predicateMono(m);

  async function handleClaim() {
    if (txState === "confirming") return;
    setTxState("confirming");
    setErrorMsg("");
    try {
      await claim({ position: p, market: m });
      setTxState("placed");
      setTimeout(() => setTxState("idle"), 2500);
    } catch (err) {
      setErrorMsg(mapClaimError(err));
      setTxState("error");
      setTimeout(() => setTxState("idle"), 4000);
    }
  }

  // Right-hand detail node — the only part that differs across states, per
  // the brief: Open shows current value + cost basis, Claimable/Refundable
  // show a CLAIM/REFUND button (same claim ix either way — the on-chain
  // `claim()` branches on market status itself, not on which button copy
  // the user saw), Claimed shows a muted checkmark, Worthless (a resolved,
  // unclaimed position with zero winning shares — see lib/positions.ts's
  // StubState doc) shows a muted "no payout" note instead of a button that
  // would only ever revert with NothingToClaim.
  let detail: React.ReactNode;
  if (state === "Open") {
    detail = (
      <span className="font-mono-num text-[10px]" style={{ color: "#555" }}>
        value {formatUsd(currentValue(p, m))} · cost {formatUsd(BigInt(p.costPaid))}
      </span>
    );
  } else if (state === "Claimable" || state === "Refundable") {
    const label = state === "Refundable" ? "REFUND" : "CLAIM";
    const buttonLabel =
      txState === "confirming"
        ? "CONFIRM…"
        : txState === "placed"
          ? "CLAIMED ✓"
          : txState === "error"
            ? errorMsg
            : `${label} ${formatUsd(claimAmount(p, m))}`;
    detail = (
      <button
        type="button"
        onClick={handleClaim}
        disabled={txState === "confirming"}
        className="font-mono-num whitespace-nowrap border px-2.5 py-1 text-[10px] font-semibold disabled:opacity-60"
        style={{
          borderColor: txState === "error" ? "#a13a3a" : "#1a7a3d",
          background: txState === "error" ? "#f5e5e5" : "#e7f2ea",
          color: txState === "error" ? "#a13a3a" : "#1a7a3d",
        }}
      >
        {buttonLabel}
      </button>
    );
  } else if (state === "Claimed") {
    detail = (
      <span className="font-mono-num text-[10px]" style={{ color: "#999" }}>
        CLAIMED ✓
      </span>
    );
  } else {
    // Worthless
    detail = (
      <span className="font-mono-num text-[10px]" style={{ color: "#999" }}>
        settled · no payout
      </span>
    );
  }

  if (compact) {
    return (
      <div className="flex items-center justify-between py-1.5" style={{ borderBottom: "1px solid #d9d6cc" }}>
        <div className="min-w-0">
          <div className="font-mono-num truncate text-[10px]" style={{ color: "#1a1d1a" }}>
            {predicate}
          </div>
          <div className="font-mono-num text-[9px]" style={{ color: "#777" }}>
            {shares}
          </div>
        </div>
        <div className="ml-2 shrink-0">{detail}</div>
      </div>
    );
  }

  return (
    <div
      className="perf-edge-top relative p-4"
      style={{ background: "var(--chalk-dim)", color: "#1a1d1a" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/fixture/${m.fixtureId}`}
            className="font-display block truncate text-[11px] font-bold tracking-[0.1em]"
            style={{ color: "#555" }}
          >
            FIXTURE {m.fixtureId}
          </Link>
          <div className="font-mono-num mt-1 text-[11px]" style={{ color: "#1a1d1a" }}>
            {predicate}
          </div>
          <div className="font-mono-num mt-1 text-[10px]" style={{ color: "#777" }}>
            {shares}
          </div>
        </div>
        <div className="shrink-0">{detail}</div>
      </div>
    </div>
  );
}
