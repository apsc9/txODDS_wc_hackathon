"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

// Truncated pubkey ("7xKp..3Fq"), the connect modal, and the connected
// dropdown (copy address / change wallet / disconnect) all come from the
// library itself — only the visual theme is ours, applied in globals.css
// via a `.ft-wallet` wrapper (NOT a `className` prop on WalletMultiButton:
// BaseWalletConnectionButton hardcodes its own className after spreading
// props, so a caller-supplied className is silently dropped — confirmed
// against the installed 0.9.36 build) to the FullTime palette per the
// approved mockup's connected-wallet pill
// (.superpowers/brainstorm/20358-1783435793/content/fixture-page-v4.html).
export function WalletButton() {
  return (
    <div className="ft-wallet">
      <WalletMultiButton />
    </div>
  );
}
