import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import Stripe from "stripe";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config, crmEnvironment } from "./config.ts";
import { db, checked, userDb } from "./db.ts";
import { paidSession } from "./payments.ts";
import { syncOne } from "./worker.ts";
export const stripe = new Stripe(config.STRIPE_SECRET_KEY, {
  maxNetworkRetries: 2,
  timeout: 15000,
});
export const app = express();
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          ...(process.env.NODE_ENV === "production" ? [] : ["'unsafe-inline'"]),
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: [
          "'self'",
          config.SUPABASE_URL,
          ...(process.env.NODE_ENV === "production"
            ? []
            : [config.APP_URL.replace(/^http/, "ws")]),
        ],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests:
          process.env.NODE_ENV === "production" ? [] : null,
      },
    },
  }),
);
app.get("/api/health", (_req, res) => res.json({ status: "ok", mode: "test" }));
app.get("/api/config", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    supabaseUrl: config.SUPABASE_URL,
    supabaseKey: config.SUPABASE_PUBLISHABLE_KEY,
  });
});
// Must precede express.json: Stripe signs the exact raw bytes.
app.post(
  "/api/webhook",
  express.raw({ type: "application/json", limit: "256kb" }),
  async (req, res) => {
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.header("stripe-signature") || "",
        config.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      res.status(400).json({ error: "Invalid webhook signature" });
      return;
    }
    try {
      const payment = paidSession(event);
      if (!payment) {
        res.json({ received: true, ignored: true });
        return;
      }
      const granted = checked(await db.rpc("pac_fulfill", payment));
      let crmSync: string | undefined;
      // Vercel functions cannot keep the local interval worker alive. Make the first
      // CRM projection attempt in the webhook request after the paid transaction
      // commits; failures remain durable in the outbox for cron or owner retry.
      if (process.env.VERCEL === "1") {
        const sync = await syncOne(payment.p_purchase);
        crmSync = sync.status ?? "not_claimed";
      }
      console.info(
        JSON.stringify({
          event: "payment_received",
          stripeEvent: event.id,
          purchaseId: payment.p_purchase,
          granted,
          ...(crmSync ? { crmSync } : {}),
        }),
      );
      // Durable worker handles CRM after the local transaction has committed.
      res.json({ received: true, granted });
    } catch {
      console.error(
        JSON.stringify({ event: "payment_rejected", stripeEvent: event.id }),
      );
      res.status(500).json({
        error: "Payment could not be applied; delivery will be retried",
      });
    }
  },
);
app.use("/api", express.json({ limit: "16kb" }));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.get("/api/cron/crm", async (req, res) => {
  const expected = config.CRON_SECRET;
  const supplied = req.header("authorization") || "";
  if (!expected) {
    res.status(503).json({ error: "Scheduled CRM worker is not configured" });
    return;
  }
  const expectedHeader = `Bearer ${expected}`;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expectedHeader);
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const outcomes: string[] = [];
  for (let i = 0; i < 3; i++) {
    const result = await syncOne();
    if (!result.claimed) break;
    outcomes.push(result.status || "unknown");
  }
  res.json({ processed: outcomes.length, outcomes });
});
app.use("/api", async (req: Request, res: Response, next: NextFunction) => {
  if (
    req.method !== "GET" &&
    req.header("origin") &&
    req.header("origin") !== config.APP_URL
  ) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }
  const token = req.header("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: "Session expired; sign in again" });
    return;
  }
  res.locals.user = data.user;
  res.locals.token = token;
  next();
});
app.post("/api/checkout", async (req, res) => {
  const { documentId } = z.object({ documentId: z.uuid() }).parse(req.body);
  const userId = res.locals.user.id;
  const purchase = checked(
    await db.rpc("pac_begin_purchase", {
      p_user: userId,
      p_document: documentId,
      p_environment: crmEnvironment,
    }),
  );
  let session: Stripe.Checkout.Session;
  if (purchase.stripe_session_id) {
    session = await stripe.checkout.sessions.retrieve(
      purchase.stripe_session_id,
    );
  } else {
    session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        adaptive_pricing: { enabled: false },
        client_reference_id: userId,
        metadata: {
          purchase_id: purchase.id,
          user_id: userId,
          document_id: documentId,
          zoho_deal_id: purchase.zoho_deal_id,
          zoho_environment: purchase.zoho_environment,
        },
        line_items: [
          {
            price_data: {
              currency: purchase.currency,
              unit_amount: purchase.amount_cents,
              product_data: { name: "The Integration Playbook" },
            },
            quantity: 1,
          },
        ],
        success_url: `${config.APP_URL}/?checkout=success`,
        cancel_url: `${config.APP_URL}/?checkout=cancelled`,
      },
      { idempotencyKey: `pac-checkout-${purchase.id}` },
    );
    checked(
      await db
        .from("pac_purchases")
        .update({
          stripe_session_id: session.id,
          checkout_expires_at: new Date(
            session.expires_at * 1000,
          ).toISOString(),
        })
        .eq("id", purchase.id)
        .select("id")
        .single(),
    );
  }
  if (session.status === "complete") {
    res
      .status(409)
      .json({ error: "Payment received. Refresh to check access." });
    return;
  }
  if (!session.url || session.status !== "open") {
    res.status(409).json({ error: "Checkout expired. Please try again." });
    return;
  }
  res.json({ url: session.url });
});
app.post("/api/purchases/:id/retry", async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const { data, error } = await userDb(res.locals.token)
    .from("pac_purchases")
    .select("id,status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "paid") {
    res.status(404).json({ error: "Paid purchase not found" });
    return;
  }
  res.json(await syncOne(id));
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Endpoint not found" }),
);
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  console.error("API operation failed");
  res
    .status(500)
    .json({ error: "Operation failed. Please refresh and try again." });
});
