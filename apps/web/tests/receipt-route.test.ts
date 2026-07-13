import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// /api/receipt/[marketPda] used to map every buildReceipt throw to 404 — a
// devnet RPC blip (connection refused, timeout, 429) rendered a perfectly
// valid receipt as "nonexistent". Account-not-found style errors (bad pda,
// no account, wrong program) stay 404; transport/RPC faults become 503.
describe("receipt route error mapping", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.doUnmock("../src/server/receipt");
    vi.doUnmock("../src/server/boot");
    vi.restoreAllMocks();
  });

  async function routeWithBuildReceiptThrowing(err: Error) {
    vi.doMock("../src/server/boot", async () => {
      const actual = await vi.importActual<typeof import("../src/server/boot")>(
        "../src/server/boot",
      );
      return { ...actual, ensureStarted: vi.fn() };
    });
    vi.doMock("../src/server/receipt", () => ({
      buildReceipt: vi.fn().mockRejectedValue(err),
    }));
    return import("../src/app/api/receipt/[marketPda]/route");
  }

  it("maps an account-not-found fetch error to 404", async () => {
    const { GET } = await routeWithBuildReceiptThrowing(
      new Error("Account does not exist or has no data 7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2"),
    );
    const res = await GET(new Request("http://test"), {
      params: Promise.resolve({ marketPda: "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2" }),
    });
    expect(res.status).toBe(404);
  });

  it("maps a malformed pda to 404", async () => {
    const { GET } = await routeWithBuildReceiptThrowing(new Error("Invalid public key input"));
    const res = await GET(new Request("http://test"), {
      params: Promise.resolve({ marketPda: "not-a-pda" }),
    });
    expect(res.status).toBe(404);
  });

  it("maps an RPC/transport failure to 503, NOT 404", async () => {
    const { GET } = await routeWithBuildReceiptThrowing(
      new Error("failed to get info about account: fetch failed ECONNREFUSED"),
    );
    const res = await GET(new Request("http://test"), {
      params: Promise.resolve({ marketPda: "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2" }),
    });
    expect(res.status).toBe(503);
  });
});
