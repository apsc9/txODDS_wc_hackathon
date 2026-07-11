"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { MarketDTO } from "@/lib/types";
import { ppmToCents } from "@/lib/fpmm";
import { predicateMono } from "@/lib/statkeys";
import { mapBuyError, useTrade, type Side } from "@/hooks/use-trade";

// ---------------------------------------------------------------------------
// Amount handling — the input is a decimal string the user types; parsing
// and formatting both stay in bigint base units (6 decimals, matches the
// stake mint) end-to-end. No `Number()`/float math ever touches the
// on-chain amount itself (Global Constraints) — Number() below is used only
// for the display-only pct-gain figure.
// ---------------------------------------------------------------------------
const DECIMALS = 6;
const UNIT = 10n ** BigInt(DECIMALS);

function parseAmount(input: string): bigint | null {
  const trimmed = input.trim();
  if (trimmed === "") return 0n;
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "000000").slice(0, DECIMALS);
  return BigInt(whole || "0") * UNIT + BigInt(fracPadded);
}

function formatAmount(base: bigint, places = 2): string {
  const whole = base / UNIT;
  const scale = 10n ** BigInt(DECIMALS - places);
  const frac = (base % UNIT) / scale;
  return `${whole}.${frac.toString().padStart(places, "0")}`;
}

const CHIPS: Array<{ label: string; add: bigint | "MAX" }> = [
  { label: "+1", add: 1n * UNIT },
  { label: "+5", add: 5n * UNIT },
  { label: "+25", add: 25n * UNIT },
  { label: "MAX", add: "MAX" },
];

type TxState = "idle" | "confirming" | "placed" | "error";

export type TradeSlipProps = {
  m: MarketDTO;
  side: Side;
  setSide: (side: Side) => void;
};

// Chalk trade slip — v4 mockup centerpiece
// (.superpowers/brainstorm/20358-1783435793/content/fixture-page-v4.html,
// "slip" block). No SELL tab: the program has no sell instruction, so a
// SELL toggle would lie about what's possible — honest deviation from the
// mockup per the brief.
export function TradeSlip({ m, side, setSide }: TradeSlipProps) {
  const { connection } = useConnection();
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { quote, buy } = useTrade();

  const [amountText, setAmountText] = useState("5");
  const [ataBalance, setAtaBalance] = useState<bigint>(0n);
  const [txState, setTxState] = useState<TxState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const amount = parseAmount(amountText) ?? 0n;

  // MAX chip needs the buyer's real ATA balance — a network read, kept
  // fully out of the quote path (quote() itself stays pure/local per
  // Global Constraints). Re-fetched on wallet/market change; failure (no
  // ATA yet) just means a 0 balance, not an error worth surfacing.
  useEffect(() => {
    let cancelled = false;
    if (!publicKey) {
      setAtaBalance(0n);
      return;
    }
    const mint = new PublicKey(m.mint);
    const ata = getAssociatedTokenAddressSync(mint, publicKey);
    connection
      .getTokenAccountBalance(ata)
      .then((res) => {
        if (!cancelled) setAtaBalance(BigInt(res.value.amount));
      })
      .catch(() => {
        if (!cancelled) setAtaBalance(0n);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, publicKey, m.mint]);

  const q = useMemo(() => quote(m, side, amount), [quote, m, side, amount]);

  const yesCents = ppmToCents(m.yesPpm);
  const noCents = 100 - yesCents;

  const pctGain =
    q && amount > 0n ? Number(((q.payout - amount) * 10000n) / amount) / 100 : null;

  function applyChip(add: bigint | "MAX") {
    const next = add === "MAX" ? ataBalance : amount + add;
    setAmountText(formatAmount(next));
  }

  async function handlePlace() {
    if (!connected) {
      setVisible(true);
      return;
    }
    if (txState === "confirming") return;
    const current = quote(m, side, amount);
    if (!current) return;

    const minSharesOut = (current.shares * 99n) / 100n; // fixed 1% slippage
    setTxState("confirming");
    setErrorMsg("");
    try {
      await buy(m, side, amount, minSharesOut);
      setTxState("placed");
      setTimeout(() => setTxState("idle"), 2500);
    } catch (err) {
      setErrorMsg(mapBuyError(err));
      setTxState("error");
      setTimeout(() => setTxState("idle"), 4000);
    }
  }

  const buttonLabel = !connected
    ? "CONNECT WALLET"
    : txState === "confirming"
      ? "CONFIRM IN WALLET…"
      : txState === "placed"
        ? "PLACED ✓"
        : txState === "error"
          ? errorMsg
          : "PLACE TRADE";

  const buttonDisabled =
    connected && (txState === "confirming" || (txState === "idle" && (!q || amount <= 0n)));

  return (
    <div
      className="perf-edge relative p-[18px] shadow-[0_10px_28px_rgba(0,0,0,0.55)]"
      style={{ background: "var(--chalk)", color: "#1a1d1a" }}
    >
      <div
        className="flex items-baseline justify-between pb-[9px]"
        style={{ borderBottom: "2px solid #1a1d1a" }}
      >
        <span className="font-display text-base font-bold tracking-[0.14em]">BUY</span>
        <span className="font-mono-num text-[9px]" style={{ color: "#777" }}>
          SLIP № {m.marketId}
        </span>
      </div>

      <div className="font-mono-num my-3 text-[10px]" style={{ color: "#555" }}>
        {predicateMono(m)}
      </div>

      <div className="mb-3.5 flex gap-2">
        <button
          type="button"
          onClick={() => setSide("YES")}
          className="font-display flex-1 py-2.5 text-center text-sm font-bold tracking-[0.1em]"
          style={
            side === "YES"
              ? { border: "2px solid var(--yes)", background: "#e7f2ea", color: "#1a7a3d" }
              : { border: "1px solid #bbb", color: "#888" }
          }
        >
          YES {yesCents}¢
        </button>
        <button
          type="button"
          onClick={() => setSide("NO")}
          className="font-display flex-1 py-2.5 text-center text-sm font-semibold tracking-[0.1em]"
          style={
            side === "NO"
              ? { border: "2px solid var(--no)", background: "#f5e5e5", color: "#a13a3a" }
              : { border: "1px solid #bbb", color: "#888" }
          }
        >
          NO {noCents}¢
        </button>
      </div>

      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[11px]" style={{ color: "#555" }}>
          Amount
        </span>
        <span className="flex items-baseline gap-1">
          <input
            type="text"
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            className="font-mono-num w-24 bg-transparent text-right text-2xl font-semibold outline-none"
            style={{ color: "#1a1d1a" }}
            aria-label="Amount in USDC"
          />
          <span className="text-xs" style={{ color: "#777" }}>
            USDC
          </span>
        </span>
      </div>

      <div className="mb-3 flex gap-1.5">
        {CHIPS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={() => applyChip(chip.add)}
            className="font-mono-num flex-1 py-1.5 text-center text-[10px]"
            style={{ border: "1px solid #ccc", color: "#1a1d1a" }}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div
        className="font-mono-num mb-1 flex justify-between text-[11px]"
        style={{ color: "#555" }}
      >
        <span>Est. shares</span>
        <span>{q ? formatAmount(q.shares) : "—"}</span>
      </div>
      <div className="font-mono-num mb-3 flex justify-between text-[11px]" style={{ color: "#1a7a3d" }}>
        <span>Payout if {side}</span>
        <span>
          {q ? `${formatAmount(q.payout)} USDC` : "—"}
          {pctGain !== null ? ` (+${pctGain.toFixed(0)}%)` : ""}
        </span>
      </div>

      <button
        type="button"
        onClick={handlePlace}
        disabled={buttonDisabled}
        className="font-display w-full py-3 text-center text-sm font-bold tracking-[0.16em] disabled:opacity-50"
        style={{
          background: txState === "error" ? "#a13a3a" : "#1a1d1a",
          color: "var(--chalk)",
        }}
      >
        {buttonLabel}
      </button>

      <div className="font-mono-num mt-2 text-center text-[8px]" style={{ color: "#999" }}>
        devnet · settles by merkle proof, not by vote
      </div>
    </div>
  );
}
