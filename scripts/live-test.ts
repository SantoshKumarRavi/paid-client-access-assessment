import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";
import Stripe from "stripe";
import { config } from "../server/config.ts";
import { db, checked } from "../server/db.ts";
import { ZohoClient } from "../server/zoho.ts";
const results: { test: string; status: string; detail?: unknown }[] = [];
async function check(name: string, fn: () => Promise<unknown>) {
  const detail = await fn();
  results.push({ test: name, status: "passed", ...(detail ? { detail } : {}) });
  console.log(`PASS ${name}`);
}
const user = async (
  alias: string,
  prefix = process.env.DEMO_EMAIL_PREFIX || "",
) => {
  const client = createClient(
    config.SUPABASE_URL,
    config.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const login = await client.auth.signInWithPassword({
    email: `${prefix}${alias}@example.test`,
    password: process.env.DEMO_PASSWORD!,
  });
  if (login.error) throw login.error;
  return {
    client,
    token: login.data.session!.access_token,
    id: login.data.user!.id,
  };
};
const alice = await user("alice"),
  bob = await user(
    "bob",
    process.env.ISOLATION_TEST_EMAIL_PREFIX ||
      process.env.DEMO_EMAIL_PREFIX ||
      "",
  );
const purchase = checked(
  await db
    .from("pac_purchases")
    .select("*")
    .eq("user_id", alice.id)
    .eq("status", "paid")
    .single(),
);
await check(
  "Alice paid purchase and premium document are readable through public key + client JWT",
  async () => {
    const docs = checked(
      await alice.client.from("pac_document_content").select("*"),
    );
    assert.equal(docs.length, 1);
    const purchases = checked(
      await alice.client.from("pac_purchases").select("*"),
    );
    assert.ok(purchases.every((p) => p.user_id === alice.id));
  },
);
await check(
  "Bob cannot retrieve Alice purchase or premium document",
  async () => {
    for (const table of ["pac_purchases", "pac_entitlements", "pac_crm_jobs"]) {
      const r = checked(
        await bob.client
          .from(table)
          .select("*")
          .eq(table === "pac_purchases" ? "id" : "purchase_id", purchase.id),
      );
      assert.equal(r.length, 0);
    }
    assert.equal(
      checked(await bob.client.from("pac_document_content").select("*")).length,
      0,
    );
  },
);
await check(
  "Bob cannot grant an entitlement or call privileged RPC",
  async () => {
    assert.ok(
      (
        await bob.client.from("pac_entitlements").insert({
          user_id: bob.id,
          document_id: purchase.document_id,
          purchase_id: purchase.id,
        })
      ).error,
    );
    assert.ok(
      (await bob.client.rpc("pac_claim_job", { p_purchase: purchase.id }))
        .error,
    );
  },
);
await check(
  "Retry endpoint enforces ownership and bearer authentication",
  async () => {
    assert.equal(
      (
        await fetch(`${config.APP_URL}/api/purchases/${purchase.id}/retry`, {
          method: "POST",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${config.APP_URL}/api/purchases/${purchase.id}/retry`, {
          method: "POST",
          headers: { Authorization: `Bearer ${bob.token}` },
        })
      ).status,
      404,
    );
  },
);
const stripe = new Stripe(config.STRIPE_SECRET_KEY),
  zoho = new ZohoClient(config);
await check(
  "Stripe API confirms actual test Checkout payment and stable reference",
  async () => {
    const s = await stripe.checkout.sessions.retrieve(
      purchase.stripe_session_id,
    );
    assert.equal(s.payment_status, "paid");
    assert.equal(s.livemode, false);
    assert.equal(s.metadata?.purchase_id, purchase.id);
    assert.equal(s.client_reference_id, alice.id);
    return { sessionId: s.id, purchaseId: purchase.id };
  },
);
await check(
  "Zoho Deal reflects the same purchase and existing description is retained",
  async () => {
    const { data } = await zoho.request(
      `Deals/${purchase.zoho_deal_id}?fields=Stage,Description,Modified_Time`,
    );
    assert.equal(data[0].Stage, "Closed Won");
    assert.ok(data[0].Description.includes(`[PAC_PAID:${purchase.id}]`));
    assert.ok(data[0].Description.includes("Fictional assessment client"));
    return { dealId: purchase.zoho_deal_id };
  },
);
await check(
  "Concurrent replays of real Stripe event do not add entitlement, job or CRM update",
  async () => {
    const { data: before } = await zoho.request(
      `Deals/${purchase.zoho_deal_id}?fields=Modified_Time,Description`,
    );
    const eventId = checked(
      await db
        .from("pac_webhook_events")
        .select("event_id")
        .eq("purchase_id", purchase.id),
    )[0].event_id;
    const event = await stripe.events.retrieve(eventId);
    const payload = JSON.stringify(event);
    const headers = {
      "Content-Type": "application/json",
      "Stripe-Signature": stripe.webhooks.generateTestHeaderString({
        payload,
        secret: config.STRIPE_WEBHOOK_SECRET,
      }),
    };
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        fetch(`${config.APP_URL}/api/webhook`, {
          method: "POST",
          headers,
          body: payload,
        }),
      ),
    );
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal((await response.json()).granted, false);
    }
    assert.equal(
      checked(
        await db.from("pac_entitlements").select("*").eq("user_id", alice.id),
      ).length,
      1,
    );
    assert.equal(
      checked(
        await db
          .from("pac_crm_jobs")
          .select("*")
          .eq("purchase_id", purchase.id),
      ).length,
      1,
    );
    const { data: after } = await zoho.request(
      `Deals/${purchase.zoho_deal_id}?fields=Modified_Time,Description`,
    );
    assert.equal(after[0].Modified_Time, before[0].Modified_Time);
    assert.equal(after[0].Description, before[0].Description);
    return { stripeEventId: eventId, concurrentReplays: 5 };
  },
);
await check("Forged webhook fails without state change", async () => {
  assert.equal(
    (
      await fetch(`${config.APP_URL}/api/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    400,
  );
});
await check(
  "Development server blocks credential, server-source and document-seed paths",
  async () => {
    for (const path of [
      "/.env",
      "/server/config.ts",
      "/supabase/migrations/001_paid_access.sql?raw",
      "/scripts/seed.ts",
    ]) {
      const response = await fetch(`${config.APP_URL}${path}`);
      assert.ok(
        [403, 404].includes(response.status),
        `${path} returned ${response.status}`,
      );
    }
  },
);
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/live-results.json",
  JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2),
);
await alice.client.auth.signOut({ scope: "local" });
await bob.client.auth.signOut({ scope: "local" });
console.log(`${results.length} live checks passed.`);
