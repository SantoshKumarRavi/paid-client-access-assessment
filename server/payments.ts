import Stripe from "stripe";
import { z } from "zod";
const metadata = z.object({
  purchase_id: z.uuid(),
  user_id: z.uuid(),
  document_id: z.uuid(),
  zoho_deal_id: z.string().regex(/^\d+$/),
  zoho_environment: z.enum(["production", "developer"]).default("production"),
});
export function paidSession(event: Stripe.Event) {
  if (event.livemode) throw Error("Live events are forbidden");
  if (
    ![
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ].includes(event.type)
  )
    return null;
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.livemode || session.mode !== "payment")
    throw Error("Invalid checkout mode");
  if (session.payment_status !== "paid") return null;
  const ids = metadata.parse(session.metadata);
  if (
    session.client_reference_id !== ids.user_id ||
    !session.id.startsWith("cs_test_") ||
    !Number.isInteger(session.amount_total) ||
    session.amount_total! <= 0 ||
    !session.currency
  )
    throw Error("Invalid checkout identity or total");
  return {
    p_event: event.id,
    p_purchase: ids.purchase_id,
    p_session: session.id,
    p_user: ids.user_id,
    p_deal: ids.zoho_deal_id,
    p_document: ids.document_id,
    p_amount: session.amount_total!,
    p_currency: session.currency,
    p_environment: ids.zoho_environment,
  };
}
