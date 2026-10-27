import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { config } from "../server/config.ts";
import { db, checked } from "../server/db.ts";
import { syncOne } from "../server/worker.ts";
import { ZohoClient } from "../server/zoho.ts";
// Run after Charlie makes a real Stripe TEST purchase, with the background worker disabled.
if (config.CRM_WORKER_ENABLED !== "false")
  throw Error("Set CRM_WORKER_ENABLED=false and restart the server first.");
const client = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const login = await client.auth.signInWithPassword({
  email: `${process.env.DEMO_EMAIL_PREFIX || ""}charlie@example.test`,
  password: process.env.DEMO_PASSWORD!,
});
if (login.error) throw login.error;
const p = checked(
  await client.from("pac_purchases").select("*").eq("status", "paid").single(),
);
const before = checked(
  await db.from("pac_crm_jobs").select("*").eq("purchase_id", p.id).single(),
);
if (before.status === "synced")
  throw Error(
    "Charlie is already synced; use a fresh fixture for outage test.",
  );
// Dependency seam deliberately injects a transport outage; no production failure endpoint.
const outage = new ZohoClient(
  {
    ...config,
    ZOHO_REFRESH_TOKEN: undefined,
    ZOHO_ACCESS_TOKEN: "offline-fixture",
  },
  (async () => new Response("", { status: 503 })) as typeof fetch,
);
const result = await syncOne(p.id, outage);
assert.equal(result.status, "pending");
const failed = checked(
  await db.from("pac_crm_jobs").select("*").eq("purchase_id", p.id).single(),
);
assert.equal(failed.status, "pending");
assert.match(failed.last_error, /503/);
assert.equal(
  checked(await client.from("pac_document_content").select("*")).length,
  1,
);
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/outage-pending.json",
  JSON.stringify(
    {
      testedAt: new Date().toISOString(),
      purchaseId: p.id,
      status: failed.status,
      lastError: failed.last_error,
      documentReadable: true,
      attempts: failed.attempts,
    },
    null,
    2,
  ),
);
console.log(
  "PASS: simulated Zoho HTTP 503 leaves real paid client entitled, CRM pending, retry scheduled.",
);
console.log(
  "Use Charlie portal Retry CRM sync to recover, then run npm run test:live again.",
);
await client.auth.signOut({ scope: "local" });
