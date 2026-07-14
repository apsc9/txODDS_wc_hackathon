// WalletButton must render a hydration-stable placeholder on the server:
// the wallet adapter's connected/disconnected state exists only in the
// browser (autoConnect fires before hydration), so any server-rendered
// library markup ("Select Wallet" vs connected pill) can mismatch the
// client's first render and trigger a recoverable hydration error.
// Regression for the live e2e finding (Jul 14): hard-loading any page with
// a connected wallet showed the Next.js hydration-failure overlay, stack
// pointing at WalletButton -> WalletMultiButton.
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("@solana/wallet-adapter-react-ui", () => ({
  // Stand-in for the real WalletMultiButton, whose output depends on
  // browser-only wallet state (the exact thing that must never reach SSR).
  WalletMultiButton: () => <button>Select Wallet</button>,
}));

import { WalletButton } from "@/components/wallet-button";

describe("WalletButton SSR", () => {
  it("does not server-render the wallet-state-dependent library button", () => {
    const html = renderToString(<WalletButton />);
    expect(html).not.toContain("Select Wallet");
  });

  it("still renders the themed .ft-wallet slot on the server", () => {
    const html = renderToString(<WalletButton />);
    expect(html).toContain("ft-wallet");
  });
});
