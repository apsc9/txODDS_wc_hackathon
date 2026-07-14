import type { ReactNode } from "react";
import type { ReceiptDTO } from "@/server/receipt";

// ---------------------------------------------------------------------------
// ReceiptChain — full-page chalk receipt, same chalk-paper DNA as
// trade-slip.tsx / create-market-modal.tsx (chalk `#F2F0E9` card, mono
// numerals, black stamp buttons) but perforated top *and* bottom
// (`.perf-edge` + the new `.perf-edge-top` in globals.css) since this is a
// standalone page, not a rail widget. Pure server component — every prop
// comes from `buildReceipt` (RSC-fetched in page.tsx), no client state or
// interactivity beyond the browser-native `<details>` hash expanders.
// ---------------------------------------------------------------------------

const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER ?? "https://explorer.solana.com";

function explorerAddress(addr: string): string {
  return `${EXPLORER}/address/${addr}?cluster=devnet`;
}

function explorerTx(sig: string): string {
  return `${EXPLORER}/tx/${sig}?cluster=devnet`;
}

// "abcd…ef12" — 4 leading + 4 trailing chars, used for both 32-byte merkle
// hashes (hex) and base58 pubkeys/signatures alike; full value always sits
// one click away (link href, or a <details> expander for bare hashes).
function truncateMiddle(s: string): string {
  return s.length <= 10 ? s : `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function fmtTs(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function Section({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span style={{ color: "var(--gold)" }}>✓</span>
        <span className="font-display text-[11px] font-bold tracking-[0.12em]">
          {n} {title}
        </span>
      </div>
      <div className="flex flex-col gap-1 pl-[18px]">{children}</div>
    </div>
  );
}

function HashList({ label, hashes }: { label: string; hashes: string[] }) {
  return (
    <div>
      <div className="text-[10px]" style={{ color: "#777" }}>
        {label}
      </div>
      {hashes.length === 0 ? (
        <div className="font-mono-num text-[10px]" style={{ color: "#aaa" }}>
          —
        </div>
      ) : (
        hashes.map((h, i) => (
          <details key={`${h}-${i}`} className="font-mono-num text-[10px]">
            <summary className="cursor-pointer" style={{ color: "#1a1d1a" }}>
              {truncateMiddle(h)}
            </summary>
            <div className="break-all pl-3" style={{ color: "#777" }}>
              {h}
            </div>
          </details>
        ))
      )}
    </div>
  );
}

function ChainArrow() {
  return (
    <div className="text-center text-[10px]" style={{ color: "#bbb" }}>
      ↓
    </div>
  );
}

function Stamp({ text, sub, tone }: { text: string; sub: string; tone: "gold" | "void" }) {
  const color = tone === "gold" ? "var(--gold)" : "#8a938c";
  return (
    <div className="mt-4 flex justify-center">
      <div
        className="inline-block -rotate-3 border-2 px-4 py-2 text-center"
        style={{ borderColor: color, color: tone === "gold" ? "#8a6a17" : "#555" }}
      >
        <div className="font-display text-sm font-bold tracking-[0.12em]">{text}</div>
        <div className="font-mono-num mt-0.5 text-[9px]">{sub}</div>
      </div>
    </div>
  );
}

function ResolvedChain({ r }: { r: ReceiptDTO }) {
  const bundle = r.bundle;
  if (!bundle) return null; // narrows for TS below; caller already checked

  return (
    <>
      <Section n="②" title="FINAL STAT">
        <div className="font-mono-num text-[12px]" style={{ color: "#1a1d1a" }}>
          value = {bundle.statA.value}
          {bundle.statB ? ` · leg B value = ${bundle.statB.value}` : ""}
        </div>
        <div className="text-[10px]" style={{ color: "#555" }}>
          packet ts: {fmtTs(bundle.ts)}
        </div>
        <div className="font-mono-num text-[10px]" style={{ color: "#555" }}>
          stat key {bundle.statA.key} · period {bundle.statA.period}
          {bundle.statB ? ` / key ${bundle.statB.key} · period ${bundle.statB.period}` : ""}
        </div>
      </Section>

      <Section n="③" title="MERKLE CHAIN">
        <HashList label="stat leaf proof" hashes={bundle.statProofHashes} />
        <ChainArrow />
        <HashList label="event stat root" hashes={[bundle.eventStatRoot]} />
        <ChainArrow />
        <HashList label="fixture subtree proof" hashes={bundle.fixtureProofHashes} />
        <ChainArrow />
        <HashList label="daily main root proof" hashes={bundle.mainTreeProofHashes} />
      </Section>

      <Section n="④" title="ON-CHAIN ANCHOR">
        <a
          href={explorerAddress(r.rootsPda)}
          target="_blank"
          rel="noreferrer"
          className="font-mono-num text-[12px] underline"
          style={{ color: "#1a1d1a" }}
        >
          {truncateMiddle(r.rootsPda)}
        </a>
        <div className="text-[10px]" style={{ color: "#555" }}>
          epoch day {r.epochDay} · oracle {truncateMiddle(r.oracleProgram)}
        </div>
      </Section>

      <Section n="⑤" title="RESOLUTION TX">
        <a
          href={explorerTx(r.resolveTx!)}
          target="_blank"
          rel="noreferrer"
          className="font-mono-num text-[12px] underline"
          style={{ color: "#1a1d1a" }}
        >
          {truncateMiddle(r.resolveTx!)}
        </a>
      </Section>

      <Stamp
        text="✓ VERIFIED"
        sub="settled by merkle proof, not by vote"
        tone="gold"
      />
    </>
  );
}

function VoidStory({ r }: { r: ReceiptDTO }) {
  return (
    <>
      <Section n="②" title="VOID">
        <div className="font-mono-num text-[12px]" style={{ color: "#1a1d1a" }}>
          no valid proof arrived by {fmtTs(r.market.voidAfterTs * 1000)} — all positions refund
          at cost basis
        </div>
      </Section>
      <Stamp
        text="VOIDED — FUNDS SAFE"
        sub="devnet · escrow never depends on TxODDS staying online"
        tone="void"
      />
    </>
  );
}

// On-chain enum names are camel-cased identifiers ("ResolvedYes"); the
// receipt shows a human label instead.
const STATUS_LABEL: Record<ReceiptDTO["status"], string> = {
  Open: "Open",
  ResolvedYes: "Resolved — YES",
  ResolvedNo: "Resolved — NO",
  Voided: "Voided",
};

function PendingNote({ status }: { status: ReceiptDTO["status"] }) {
  return (
    <div
      className="font-mono-num mt-1 border px-3 py-2 text-[11px]"
      style={{ borderColor: "#ccc", color: "#777" }}
    >
      market status: {STATUS_LABEL[status]} — no resolution proof on chain yet
    </div>
  );
}

export type ReceiptChainProps = { r: ReceiptDTO };

export function ReceiptChain({ r }: ReceiptChainProps) {
  const statusColor =
    r.status === "ResolvedYes" ? "var(--yes)" : r.status === "ResolvedNo" ? "var(--no)" : "#777";

  return (
    <div className="mx-auto max-w-lg">
      <div
        className="perf-edge perf-edge-top relative p-[22px] shadow-[0_10px_28px_rgba(0,0,0,0.55)]"
        style={{ background: "var(--chalk)", color: "#1a1d1a" }}
      >
        <div
          className="flex items-baseline justify-between pb-[9px]"
          style={{ borderBottom: "2px solid #1a1d1a" }}
        >
          <span className="font-display text-base font-bold tracking-[0.14em]">
            RESOLUTION RECEIPT
          </span>
          <span className="font-mono-num text-[9px]" style={{ color: "#777" }}>
            SLIP № {r.market.marketId}
          </span>
        </div>

        <div className="font-mono-num my-3 text-[11px]" style={{ color: statusColor }}>
          {STATUS_LABEL[r.status]}
        </div>

        <Section n="①" title="MARKET">
          <div className="text-[12px]" style={{ color: "#1a1d1a" }}>
            {r.predicate.human}
          </div>
          <div className="font-mono-num text-[10px]" style={{ color: "#777" }}>
            {r.predicate.mono}
          </div>
          <div className="text-[10px]" style={{ color: "#555" }}>
            fixture {r.market.fixtureId}
          </div>
        </Section>

        {r.voided ? (
          <VoidStory r={r} />
        ) : r.bundle ? (
          <ResolvedChain r={r} />
        ) : (
          <PendingNote status={r.status} />
        )}

        <div className="font-mono-num mt-3 text-center text-[8px]" style={{ color: "#999" }}>
          devnet · market {truncateMiddle(r.market.pda)}
        </div>
      </div>
    </div>
  );
}
