import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import Stripe from "stripe";
process.env.APP_URL = "http://localhost:4242";
process.env.SUPABASE_URL = "http://localhost:9999";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_offline_fixture";
process.env.SUPABASE_SECRET_KEY = "sb_secret_offline_fixture";
process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture";
const { app } = await import("../server/app.ts");
test("public config exposes only publishable configuration and security headers", async () => {
  const r = await request(app).get("/api/config").expect(200);
  assert.deepEqual(Object.keys(r.body).sort(), ["supabaseKey", "supabaseUrl"]);
  assert.match(r.body.supabaseKey, /publishable/);
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.match(r.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(r.headers["cache-control"], "no-store");
});
test("scheduled CRM route is unavailable until an operator secret is configured", async () => {
  await request(app).get("/api/cron/crm").expect(503);
});
test("private mutations require a bearer session", async () => {
  await request(app)
    .post("/api/checkout")
    .send({ documentId: "11111111-1111-4111-8111-111111111111" })
    .expect(401);
  await request(app).post("/api/purchases/123/retry").send({}).expect(401);
});
test("cross-origin mutations are rejected", async () => {
  await request(app)
    .post("/api/checkout")
    .set("Origin", "https://attacker.example")
    .send({})
    .expect(403);
});
test("webhook endpoint rejects unsigned and altered bytes; acknowledges irrelevant signed event", async () => {
  await request(app)
    .post("/api/webhook")
    .send({ type: "checkout.session.completed" })
    .expect(400);
  const stripe = new Stripe("sk_test_fixture"),
    payload = JSON.stringify({
      id: "evt_ignore",
      type: "customer.created",
      livemode: false,
      data: { object: { id: "cus_test" } },
    });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: "whsec_fixture",
  });
  await request(app)
    .post("/api/webhook")
    .set("Content-Type", "application/json")
    .set("stripe-signature", signature)
    .send(payload + " ")
    .expect(400);
  const r = await request(app)
    .post("/api/webhook")
    .set("Content-Type", "application/json")
    .set("stripe-signature", signature)
    .send(payload)
    .expect(200);
  assert.equal(r.body.ignored, true);
});
