"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { Fixture, MarketDTO } from "@/lib/types";
import {
  canNeedZeroStat,
  encodeStatKey,
  predicateHuman,
  predicateMono,
  type PredicateFields,
} from "@/lib/statkeys";
import {
  MIN_SEED_LIQUIDITY,
  defaultTimes,
  localInputToTs,
  mapCreateError,
  mintForFixture,
  parseTokenAmount,
  presetPredicate,
  tsToLocalInput,
  useCreateMarket,
  type PresetId,
} from "@/hooks/use-create-market";

// ---------------------------------------------------------------------------
// CreateMarketModal — permissionless market creation on chalk paper, same
// slip DNA as trade-slip.tsx (chalk card, mono predicate line, black stamp
// button, .perf-edge). Presets are FT-only; Custom exposes period +
// comparison + both stat keys + op.
// ---------------------------------------------------------------------------

type PresetChoice = PresetId | "custom";

const PRESETS: Array<{ id: PresetChoice; label: string }> = [
  { id: "goals", label: "Total goals over N" },
  { id: "corners", label: "Total corners over N" },
  { id: "yellows", label: "Total yellows over N" },
  { id: "homeWin", label: "Home team to win" },
  { id: "custom", label: "Custom" },
];

// Base stat keys 1..8 (Global Constraints: odd = T1, even = T2).
const STAT_OPTIONS = [
  { value: 1, label: "GOALS T1" },
  { value: 2, label: "GOALS T2" },
  { value: 3, label: "YELLOWS T1" },
  { value: 4, label: "YELLOWS T2" },
  { value: 5, label: "REDS T1" },
  { value: 6, label: "REDS T2" },
  { value: 7, label: "CORNERS T1" },
  { value: 8, label: "CORNERS T2" },
];

const PERIOD_OPTIONS = [
  { value: 0, label: "FT (full match)" },
  { value: 1, label: "P1 (1st half)" },
  { value: 2, label: "P2 (2nd half)" },
];

const COMPARISON_OPTIONS: Array<{ value: PredicateFields["comparison"]; label: string }> = [
  { value: "GreaterThan", label: "> greater than" },
  { value: "LessThan", label: "< less than" },
  { value: "EqualTo", label: "== equal to" },
];

type TxState = "idle" | "confirming" | "created" | "error";

// Shared look for chalk-paper form controls (selects/inputs on the card).
const fieldStyle = {
  border: "1px solid #ccc",
  background: "transparent",
  color: "#1a1d1a",
} as const;

export type CreateMarketModalProps = {
  f: Fixture;
  markets: MarketDTO[];
  onClose: () => void;
};

export function CreateMarketModal({ f, markets, onClose }: CreateMarketModalProps) {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const { create } = useCreateMarket();

  const [preset, setPreset] = useState<PresetChoice>("goals");
  const [threshold, setThreshold] = useState(2);

  // Custom-only predicate state (one period select covers both stat keys —
  // cross-period predicates are expressible on-chain but not a shape any
  // preset or seeded market uses; YAGNI).
  const [period, setPeriod] = useState(0);
  const [baseA, setBaseA] = useState(1);
  const [baseB, setBaseB] = useState<number | null>(2);
  const [op, setOp] = useState<"Add" | "Subtract">("Add");
  const [comparison, setComparison] = useState<PredicateFields["comparison"]>("GreaterThan");

  const defaults = defaultTimes(f.StartTime);
  const [resolveLocal, setResolveLocal] = useState(() => tsToLocalInput(defaults.resolveAfterTs));
  const [voidLocal, setVoidLocal] = useState(() => tsToLocalInput(defaults.voidAfterTs));
  const [liquidityText, setLiquidityText] = useState("50");

  const [txState, setTxState] = useState<TxState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const predicate: PredicateFields = useMemo(() => {
    if (preset !== "custom") return presetPredicate(preset, threshold);
    return {
      statKeyA: encodeStatKey(period, baseA),
      statKeyB: baseB !== null ? encodeStatKey(period, baseB) : null,
      op: baseB !== null ? op : null,
      comparison,
      threshold,
    };
  }, [preset, threshold, period, baseA, baseB, op, comparison]);

  const zeroStatWarn = canNeedZeroStat(predicate);

  const liquidity = parseTokenAmount(liquidityText);
  const liquidityTooLow = liquidity === null || liquidity < MIN_SEED_LIQUIDITY;
  const resolveAfterTs = localInputToTs(resolveLocal);
  const voidAfterTs = localInputToTs(voidLocal);
  const timesInvalid =
    resolveAfterTs === null || voidAfterTs === null || voidAfterTs <= resolveAfterTs;

  const formInvalid = liquidityTooLow || timesInvalid;

  async function handleCreate() {
    if (!connected) {
      setVisible(true);
      return;
    }
    if (txState === "confirming" || formInvalid) return;

    setTxState("confirming");
    setErrorMsg("");
    try {
      await create({
        fixtureId: f.FixtureId,
        predicate,
        seedLiquidity: liquidity!,
        resolveAfterTs: resolveAfterTs!,
        voidAfterTs: voidAfterTs!,
        mintHint: mintForFixture(markets),
      });
      setTxState("created");
      setTimeout(onClose, 1600);
    } catch (err) {
      setErrorMsg(mapCreateError(err));
      setTxState("error");
      setTimeout(() => setTxState("idle"), 4000);
    }
  }

  const buttonLabel = !connected
    ? "CONNECT WALLET"
    : txState === "confirming"
      ? "CONFIRM IN WALLET…"
      : txState === "created"
        ? "CREATED ✓"
        : txState === "error"
          ? errorMsg
          : "CREATE MARKET";

  const buttonDisabled =
    connected && (txState === "confirming" || (txState === "idle" && formInvalid));

  const showThreshold = preset !== "homeWin";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create market"
        onClick={(e) => e.stopPropagation()}
        className="perf-edge relative max-h-[90vh] w-full max-w-sm overflow-y-auto p-[18px] shadow-[0_10px_28px_rgba(0,0,0,0.55)]"
        style={{ background: "var(--chalk)", color: "#1a1d1a" }}
      >
        <div
          className="flex items-baseline justify-between pb-[9px]"
          style={{ borderBottom: "2px solid #1a1d1a" }}
        >
          <span className="font-display text-base font-bold tracking-[0.14em]">CREATE MARKET</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="font-mono-num text-[11px]"
            style={{ color: "#777" }}
          >
            ✕ CLOSE
          </button>
        </div>

        <div className="font-mono-num my-3 text-[10px]" style={{ color: "#555" }}>
          {f.Participant1} vs {f.Participant2} · fixture {f.FixtureId}
        </div>

        <label className="mb-2.5 block">
          <span className="text-[11px]" style={{ color: "#555" }}>
            Market type
          </span>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as PresetChoice)}
            className="font-mono-num mt-1 w-full px-2 py-1.5 text-[12px]"
            style={fieldStyle}
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        {showThreshold && (
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[11px]" style={{ color: "#555" }}>
              Threshold
            </span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setThreshold((t) => Math.max(0, t - 1))}
                aria-label="Decrease threshold"
                className="font-mono-num h-7 w-7 text-center text-[13px]"
                style={fieldStyle}
              >
                −
              </button>
              <span className="font-mono-num w-8 text-center text-xl font-semibold">{threshold}</span>
              <button
                type="button"
                onClick={() => setThreshold((t) => t + 1)}
                aria-label="Increase threshold"
                className="font-mono-num h-7 w-7 text-center text-[13px]"
                style={fieldStyle}
              >
                +
              </button>
            </span>
          </div>
        )}

        {preset === "custom" && (
          <div className="mb-2.5 flex flex-col gap-2">
            <label className="block">
              <span className="text-[11px]" style={{ color: "#555" }}>
                Period
              </span>
              <select
                value={period}
                onChange={(e) => setPeriod(Number(e.target.value))}
                className="font-mono-num mt-1 w-full px-2 py-1.5 text-[12px]"
                style={fieldStyle}
              >
                {PERIOD_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <label className="block flex-1">
                <span className="text-[11px]" style={{ color: "#555" }}>
                  Stat A
                </span>
                <select
                  value={baseA}
                  onChange={(e) => setBaseA(Number(e.target.value))}
                  className="font-mono-num mt-1 w-full px-2 py-1.5 text-[12px]"
                  style={fieldStyle}
                >
                  {STAT_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block w-20">
                <span className="text-[11px]" style={{ color: "#555" }}>
                  Op
                </span>
                <select
                  value={baseB === null ? "" : op}
                  disabled={baseB === null}
                  onChange={(e) => setOp(e.target.value as "Add" | "Subtract")}
                  className="font-mono-num mt-1 w-full px-2 py-1.5 text-[12px] disabled:opacity-40"
                  style={fieldStyle}
                >
                  {baseB === null ? (
                    <option value="">—</option>
                  ) : (
                    <>
                      <option value="Add">+</option>
                      <option value="Subtract">−</option>
                    </>
                  )}
                </select>
              </label>
              <label className="block flex-1">
                <span className="text-[11px]" style={{ color: "#555" }}>
                  Stat B
                </span>
                <select
                  value={baseB === null ? "" : baseB}
                  onChange={(e) => setBaseB(e.target.value === "" ? null : Number(e.target.value))}
                  className="font-mono-num mt-1 w-full px-2 py-1.5 text-[12px]"
                  style={fieldStyle}
                >
                  <option value="">none</option>
                  {STAT_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="text-[11px]" style={{ color: "#555" }}>
                Comparison
              </span>
              <select
                value={comparison}
                onChange={(e) => setComparison(e.target.value as PredicateFields["comparison"])}
                className="font-mono-num mt-1 w-full px-2 py-1.5 text-[12px]"
                style={fieldStyle}
              >
                {COMPARISON_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="font-mono-num mb-2.5 border-y py-2 text-[11px]" style={{ borderColor: "#ddd" }}>
          <div style={{ color: "#1a1d1a" }}>
            {predicateHuman(predicate, f.Participant1, f.Participant2)}
          </div>
          <div className="mt-0.5 text-[10px]" style={{ color: "#777" }}>
            {predicateMono(predicate)}
          </div>
        </div>

        {zeroStatWarn && (
          <div
            className="font-mono-num mb-2.5 border px-2 py-1.5 text-[10px]"
            style={{ borderColor: "var(--gold)", color: "#8a6a17", background: "#faf3df" }}
          >
            this predicate can only settle NO/YES via the void path on a zero stat — funds refund
            at cost basis
          </div>
        )}

        <label className="mb-2 block">
          <span className="text-[11px]" style={{ color: "#555" }}>
            Resolvable after
          </span>
          <input
            type="datetime-local"
            value={resolveLocal}
            onChange={(e) => setResolveLocal(e.target.value)}
            className="font-mono-num mt-1 w-full px-2 py-1.5 text-[12px]"
            style={fieldStyle}
          />
        </label>
        <label className="mb-2 block">
          <span className="text-[11px]" style={{ color: "#555" }}>
            Voidable after (no proof by then → refunds)
          </span>
          <input
            type="datetime-local"
            value={voidLocal}
            onChange={(e) => setVoidLocal(e.target.value)}
            className="font-mono-num mt-1 w-full px-2 py-1.5 text-[12px]"
            style={fieldStyle}
          />
        </label>
        {timesInvalid && (
          <div className="font-mono-num mb-2 text-[10px]" style={{ color: "#a13a3a" }}>
            void time must come after resolve time
          </div>
        )}

        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px]" style={{ color: "#555" }}>
            Seed liquidity (min 10)
          </span>
          <span className="flex items-baseline gap-1">
            <input
              type="text"
              inputMode="decimal"
              value={liquidityText}
              onChange={(e) => setLiquidityText(e.target.value)}
              className="font-mono-num w-24 bg-transparent text-right text-2xl font-semibold outline-none"
              style={{ color: "#1a1d1a" }}
              aria-label="Seed liquidity in USDC"
            />
            <span className="text-xs" style={{ color: "#777" }}>
              USDC
            </span>
          </span>
        </div>
        {liquidityTooLow && (
          <div className="font-mono-num mb-2 text-[10px]" style={{ color: "#a13a3a" }}>
            seed at least 10 test-USDC (starts the YES/NO pools at 50/50)
          </div>
        )}

        <button
          type="button"
          onClick={handleCreate}
          disabled={buttonDisabled}
          className="font-display mt-2 w-full py-3 text-center text-sm font-bold tracking-[0.16em] disabled:opacity-50"
          style={{
            background: txState === "error" ? "#a13a3a" : "#1a1d1a",
            color: "var(--chalk)",
          }}
        >
          {buttonLabel}
        </button>

        <div className="font-mono-num mt-2 text-center text-[8px]" style={{ color: "#999" }}>
          devnet · permissionless · settles by merkle proof, not by vote
        </div>
      </div>
    </div>
  );
}
