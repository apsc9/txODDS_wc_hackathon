import { authenticate, apiClient } from "./auth.js";
import type { Network } from "./config.js";

const network = (process.argv[2] ?? "devnet") as Network;
const creds = await authenticate(network);
console.log("wallet:", creds.wallet, "| activatedAt:", creds.activatedAt);
const { data } = await apiClient(network, creds).get("/api/fixtures/snapshot");
console.log("fixtures snapshot entries:", Array.isArray(data) ? data.length : JSON.stringify(data).slice(0, 300));
if (Array.isArray(data) && data.length) console.log("sample fixture:", JSON.stringify(data[0]).slice(0, 500));
