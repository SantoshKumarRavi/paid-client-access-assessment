# Paid Client Access / Fieldnotes

A small, working assessment portal: Supabase signs clients in and enforces document ownership; Stripe **test** Checkout takes a one-time payment; a verified webhook commits access and a durable CRM job; the worker marks the exact Zoho Developer Edition Deal as **Closed Won** with a purchase receipt in its Description.

The browser reads access, purchases, and CRM status **directly from Supabase** using its public key and the signed-in client's JWT. Stripe, Zoho, and the Supabase privileged key are used only by the server and operator scripts.

## Run on this computer

The local `.env` is already configured. It contains secrets and must stay local.

```powershell
cd E:\knowbal
npm ci
# Terminal 1: keep the official Stripe CLI forwarding test webhooks
npm run stripe:listen
# Copy its whsec_ value into STRIPE_WEBHOOK_SECRET in .env if it changed.
# Terminal 2:
npm run dev
```

Open <http://localhost:4242>. The final Developer Edition fixtures are `dev-alice@example.test`, `dev-bob@example.test`, and `dev-charlie@example.test`. Their password is the value of `DEMO_PASSWORD` in the local `.env`. Never put that password or the `.env` in your submission. Alice and Charlie are paid demonstrations. Use `audit-bob@example.test` as the unpaid isolation control; this separate account keeps your `dev-bob` purchase walkthrough independent of security tests.

For a new, repeatable interview purchase without deleting existing evidence:

```powershell
npx tsx scripts/seed.ts --prefix=interview-
```

Sign in as `interview-alice@example.test` with the same local demo password. Each prefix creates distinct fictional Supabase identities and matching Developer Edition Deals. The seed is safe to rerun with the same prefix. It never resets existing identities or purchases.

## Vercel demo deployment

The project supports Vercel's Node.js function runtime. React assets build to `dist`; the catch-all API function exports the same Express application. Vercel cannot keep the local interval worker alive, so the paid webhook makes the initial Zoho attempt after the Supabase fulfillment transaction commits. Failed CRM work stays durable and can be retried from the signed-in portal. A protected Vercel Cron Job drains due outbox work once daily on the Hobby plan; Vercel Hobby only permits daily schedules. On a plan that supports more frequent Cron schedules, change the cron expression in `vercel.json` and redeploy.

Configure these Vercel Environment Variables for Production and Preview only as needed:

- `APP_URL`: exact deployed origin, for example `https://<project>.vercel.app` (no trailing slash)
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` from Stripe TEST mode / deployed webhook endpoint
- `ZOHO_ACCOUNTS_URL`, `ZOHO_API_URL`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_PAID_STAGE`
- `CRM_WORKER_ENABLED=false` (the persistent local interval worker is not used in serverless)
- `CRON_SECRET`: random value of at least 32 characters, used by the protected scheduled route
- `DEMO_PASSWORD`: only needed if seeding new demo identities; never expose it in frontend configuration

After the first deployment, set `APP_URL` to the assigned Vercel origin and redeploy. In Stripe TEST mode, add `https://<project>.vercel.app/api/webhook` as an endpoint for `checkout.session.completed` and `checkout.session.async_payment_succeeded`, then put that endpoint's signing secret in Vercel and redeploy. Do not reuse the Stripe CLI listener secret. The existing `dev-` demo identities and matching Zoho Developer Edition Deals are already provisioned in the connected Supabase and Zoho test environments. Use the unpaid Bob identity for a fresh test purchase; payment details remain on Stripe Checkout.

The public demo is test-only: keep `STRIPE_SECRET_KEY` in `sk_test_` mode. Deploy only after confirming the configured Supabase and Zoho accounts are the assessment test environments. The Vercel route `/api/cron/crm` requires `Authorization: Bearer $CRON_SECRET`; an unauthenticated request is rejected.

## Set up from a clean checkout

1. Install Node.js 22.16 or newer and the [official Stripe CLI](https://docs.stripe.com/stripe-cli). Run `npm ci`.
2. Copy `.env.example` to `.env`. Set `APP_URL=http://localhost:4242`, the Supabase project URL, a publishable/anon key, and a server-only secret/service-role key. The server rejects privileged keys accidentally supplied as the browser key.
3. In Supabase SQL Editor, run the complete migration files **once, in numerical order**: `001_paid_access.sql`, `002_crm_environment.sql`, and `003_strict_payment_validation.sql`. Keep each file's transaction intact. They create only `pac_*` tables/functions, policies, and sample document content. Do not rerun initial CREATE TABLE migrations on an already provisioned database.
4. Alternatively, with PostgreSQL's `psql` and a direct/pooler database connection available, use:

   ```powershell
   psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/001_paid_access.sql
   psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/002_crm_environment.sql
   psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/003_strict_payment_validation.sql
   ```

5. Use a Stripe sandbox/test account and an `sk_test_` key. Live keys and live webhook events are rejected. No pre-created Stripe Product/Price is necessary: the server creates a fixed USD 19.00 Checkout line item from the database price. Adaptive Pricing is disabled so the signed amount and currency must match exactly.
6. Access [Zoho CRM Developer Edition](https://developers.zoho.in/crm/tab/Home/begin). In the [India API Console](https://api-console.zoho.in/), use a Self Client, generate a grant with `ZohoCRM.modules.deals.READ,ZohoCRM.modules.deals.CREATE,ZohoCRM.modules.deals.UPDATE`, and select **Developer Account**, not Production. Exchange the short-lived grant server-side for a refresh token. Set `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ACCOUNTS_URL=https://accounts.zoho.in`, and `ZOHO_API_URL=https://developer.zohoapis.in`. Never expose the grant or tokens in the browser app. Other supported regional API origins are listed in `server/config.ts`.
7. Run `npm run stripe:listen`. Equivalent CLI command after `stripe login`:

   ```powershell
   stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded --forward-to localhost:4242/api/webhook
   ```

   Set `STRIPE_WEBHOOK_SECRET` to the listener's `whsec_` value, then restart the app. A dashboard endpoint has a different signing secret; do not mix them.

8. Run `npm run seed`, then `npm run dev`. The seed creates three fictional clients, confirms their test email identities through the admin API, creates the corresponding Deals, and stores immutable user/Deal/environment mappings. A missing `DEMO_PASSWORD` is generated and saved locally. Use a dedicated test project: provisioning with the admin API is an operator action, not a public signup endpoint.

For a built client bundle: `npm run build`, set `NODE_ENV=production` in your shell, then `npm start`. The HTTP server binds to `127.0.0.1`; this deliverable is a local assessment environment. An actual deployment needs managed secrets, HTTPS ingress, a public Stripe webhook endpoint, process supervision, and monitoring.

## Tests and evidence

```powershell
npm test                  # Offline real PostgreSQL/PGlite, HTTP, Stripe-signature and CRM transport tests
npm run build             # TypeScript checks + production frontend build
npm run test:live         # Real Supabase + Stripe + Zoho checks after dev-alice pays
npm run crm:retry         # Process up to 25 due jobs in the configured CRM environment
npm run crm:retry -- PURCHASE_UUID  # Explicitly retry one paid purchase
```

`test:live` requires the server running, paid `dev-alice`, and a seeded unpaid `audit-bob`. Run `npm run seed`, then `npx tsx scripts/seed.ts --prefix=audit-` once. It fetches Alice's real Stripe event, re-signs that **existing event payload** with the local listener secret, sends five concurrent local replays, and checks one entitlement, one CRM job, and unchanged Zoho modification time/Description. This is a local replay test, not a claim of five new deliveries originating at Stripe. The original payment is delivered by the actual Stripe CLI listener.

`stripe trigger checkout.session.completed` creates a generic fixture without this app's stable IDs and does not demonstrate a valid portal purchase. Use the portal checkout instead.

### Manual acceptance tests

1. Sign in as a fresh prefixed Alice. The document is locked. Direct client queries cannot read `pac_document_content`.
2. Select **Unlock document**. In the Stripe **Sandbox** form, enter fictional email/name and card `4242 4242 4242 4242`, any future expiry, and any three-digit CVC. Do not enter a real card or save a payment method.
3. Pay. Check the listener returns HTTP 200. The portal polls Supabase every five seconds. Payment becomes confirmed, document access granted, and CRM sync completed. Open **Read document**.
4. In Supabase, trace the same purchase UUID through `pac_purchases`, `pac_webhook_events`, `pac_entitlements`, and `pac_crm_jobs`. Match its `user_id`, `stripe_session_id`, `zoho_deal_id`, and `zoho_environment`.
5. In Zoho Developer Edition, find the Deal named `PAC Assessment - Alice Morgan - <user-id-prefix>`. Its Stage is Closed Won. Description retains the original notes and contains `[PAC_PAID:<purchase UUID>]` plus the Stripe test session ID.
6. Run `npm run test:live` using the baseline `dev-` fixtures. Five concurrent replays return `granted:false`; the Deal is not modified again.
7. In a separate browser session, sign in as unpaid Bob. He has no Alice purchase, entitlement, CRM job, or document. Client-side inserts/updates and privileged RPCs are denied, even if a caller knows Alice's UUID. Bob's retry request for Alice returns 404.
8. For a decline test on a fresh client, use `4000 0000 0000 0002`. Stripe shows a decline; the purchase stays pending and no entitlement is created. Retrying with the successful test card can complete that same Checkout.

### CRM outage and recovery

Use a **fresh** fixture; never remove a paid entitlement to stage a failure.

1. Set `CRM_WORKER_ENABLED=false` in `.env` and restart the server before the purchase. Use a fresh Charlie (or set a new `DEMO_EMAIL_PREFIX` and seed that prefix).
2. Complete Charlie's real Stripe test checkout. Supabase grants access and creates the pending CRM job without contacting Zoho.
3. Run `npm run test:outage`. This uses the normal worker/adapter with an injected HTTP 503 transport in the **operator script only**. It verifies pending status, a persisted error, a scheduled retry, and continued client document access. It does not shut down Zoho or expose a failure switch in the public app.
4. In Charlie's portal select **Retry CRM sync**, or run `npm run crm:retry -- PURCHASE_UUID`. The normal real Zoho adapter updates the exact Deal and marks the job synced. Access remains active throughout.
5. Restore `CRM_WORKER_ENABLED=true` and restart the app. Automatic retries use exponential delay, capped at one hour; an explicit retry bypasses the delay but cannot take an active lease.

Raw local run results are in ignored `test-results/`; selected sanitized evidence is included under `docs/evidence/`. The PDF contains the final environment, HLD, LLD, state flows, requirement coverage, observed tests, tradeoffs, and a 15-minute interview walkthrough.

## Core correctness decisions

- **Stable IDs, never email matching:** authenticated Supabase user UUID -> server-owned client/Deal/environment mapping -> immutable purchase UUID -> Stripe session metadata + client reference. Price, currency, Deal and environment are validated again inside the fulfillment transaction.
- **Verified payment only:** raw request bytes are verified before JSON parsing. Only paid one-time `checkout.session.completed` or `checkout.session.async_payment_succeeded` test events can fulfill. A redirect cannot grant access.
- **Atomic entitlement + outbox:** the event receipt, paid purchase, unique entitlement, and unique CRM job commit together. Database failure returns 500 so delivery can retry; CRM availability is outside that transaction.
- **Two levels of deduplication:** primary-key Stripe event receipt and paid-purchase state handle repeated/different events; a unique `(user_id,document_id)` entitlement and one job per purchase enforce business invariants. The server reuses pending purchases and Stripe's idempotency key when creating Checkout.
- **Durable retries:** PostgreSQL `FOR UPDATE SKIP LOCKED`, a two-minute lease, and a random lease token coordinate workers. Fenced completion cannot overwrite a newer attempt. A crash leaves work recoverable after lease expiry.
- **CRM reconciliation:** GET the Deal before PUT; a receipt marker detects an earlier successful update whose response was lost. Preserve Description; use `If-Unmodified-Since`; suppress workflow/cadence triggers for the assessment update. Validate per-record success even when HTTP succeeds.
- **Security at the database:** authenticated clients get SELECT only; RLS filters ownership. Document content requires an entitlement. Webhook receipts and privileged RPCs have no client grants. Server routes verify Supabase JWTs and retry ownership. Development file serving denies secrets, server code, migrations and documentation. Production serves only `dist/`.
- **Environment safety:** production/trial and Developer Edition have separate Deal namespaces. Checkout validates the mapping's environment, metadata carries it, and workers claim only their configured environment. Earlier trial evidence remains intact; the final configured flow uses Developer Edition.

## Limits to explain honestly

Zoho's ordinary record update API is not a distributed transaction participant and does not provide a general idempotency key. Normal webhook replays do not create another CRM write. Read-before-write receipt reconciliation handles common timeout/crash cases. Leases and conditional writes reduce races, but this is **not an absolute mathematical exactly-once guarantee** across arbitrarily delayed external requests, concurrent manual edits, or a provider whose timestamp resolution is coarse. Production would add a dedicated immutable unique CRM receipt field or provider-supported operation ledger and reconciliation/alerts.

Refunds, disputes, subscription renewals, revocation, multiple catalog documents, document download/DRM, and a customer provisioning UI are outside this one-time-access assessment. Delayed-success handling is implemented and tested with signed fixtures; real browser purchases use cards. Large files should move to private Supabase Storage with entitlement-aware object policies or short-lived downloads. An authorized reader can still copy content they can read; RLS is authorization, not DRM.

No credentials are committed or included in the submission archive. Existing `.env.trial` is a local-only backup of the earlier trial integration. The final environment uses `.env` and `dev-` fixtures. Do not submit either secret file.

## Source map

| Area                                         | Implementation                                             |
| -------------------------------------------- | ---------------------------------------------------------- |
| Portal and direct Supabase reads             | `web/main.tsx`, `web/styles.css`                           |
| Raw webhook, authenticated checkout/retry    | `server/app.ts`, `server/payments.ts`                      |
| Credentials and server Supabase clients      | `server/config.ts`, `server/db.ts`                         |
| Durable worker and real Zoho adapter         | `server/worker.ts`, `server/zoho.ts`                       |
| Tables, RLS, locks and RPCs                  | `supabase/migrations/001_*.sql` through `003_*.sql`        |
| Repeatable sample data and operator commands | `scripts/seed.ts`, `scripts/retry.ts`                      |
| Offline / live / outage tests                | `tests/`, `scripts/live-test.ts`, `scripts/outage-test.ts` |

References: [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment), [Stripe webhook signatures](https://docs.stripe.com/webhooks/signature), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Zoho update records](https://www.zoho.com/crm/developer/docs/api/v8/update-records.html), [Zoho environments](https://help.zoho.com/portal/en/community/topic/kaizen-5-environments-and-domains-in-zoho-crm-part-1-2).
