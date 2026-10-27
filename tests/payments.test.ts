import { test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { paidSession } from "../server/payments.ts";
const stripe = new Stripe("sk_test_fixture");
const session = {
  id: "cs_test_valid",
  mode: "payment",
  livemode: false,
  payment_status: "paid",
  client_reference_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  amount_total: 1900,
  currency: "usd",
  metadata: {
    purchase_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    document_id: "11111111-1111-4111-8111-111111111111",
    zoho_deal_id: "101",
  },
};
const event = (obj: any = session, type = "checkout.session.completed") =>
  ({
    id: "evt_test",
    type,
    livemode: false,
    data: { object: obj },
  }) as Stripe.Event;
test("Stripe validates exact raw bytes and rejects forged, stale or missing signatures", () => {
  const payload = JSON.stringify(event()),
    secret = "whsec_test";
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
  });
  assert.equal(
    stripe.webhooks.constructEvent(payload, signature, secret).id,
    "evt_test",
  );
  for (const [body, sig] of [
    [payload + " ", signature],
    [payload, ""],
    [
      payload,
      stripe.webhooks.generateTestHeaderString({
        payload,
        secret,
        timestamp: 1,
      }),
    ],
  ])
    assert.throws(() => stripe.webhooks.constructEvent(body, sig, secret));
});
test("paid checkout maps stable IDs; delayed success is handled", () => {
  assert.equal(paidSession(event())?.p_deal, "101");
  assert.ok(
    paidSession(event(session, "checkout.session.async_payment_succeeded")),
  );
});
test("unpaid checkout and unrelated events never grant access", () => {
  assert.equal(
    paidSession(event({ ...session, payment_status: "unpaid" })),
    null,
  );
  assert.equal(paidSession(event(session, "payment_intent.succeeded")), null);
});
test("reject live mode, wrong reference, missing IDs, invalid amount and wrong session mode", () => {
  for (const obj of [
    { ...session, livemode: true },
    { ...session, client_reference_id: "someone-else" },
    { ...session, metadata: {} },
    { ...session, amount_total: 0 },
    { ...session, mode: "subscription" },
  ])
    assert.throws(() => paidSession(event(obj)));
  assert.throws(() => paidSession({ ...event(), livemode: true }));
});
