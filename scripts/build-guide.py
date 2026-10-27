"""Build the assessment handover PDF from verified local evidence. Requires reportlab."""
from pathlib import Path
import json, textwrap, html
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image, KeepTogether, Preformatted
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon
from reportlab.lib.utils import ImageReader

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/pdf/Paid_Client_Access_Implementation_Deep_Dive_Dark.pdf'
OUT.parent.mkdir(parents=True,exist_ok=True)
EVIDENCE=ROOT/'docs/evidence'
state=json.loads((EVIDENCE/'current-state.json').read_text())
live=json.loads((EVIDENCE/'live-results.json').read_text())
outage=json.loads((EVIDENCE/'outage-pending.json').read_text())
clients=state['clients']
alice=next(c for c in clients if c['email'].endswith('alice@example.test'))
charlie=next(c for c in clients if c['email'].endswith('charlie@example.test'))
purchase=next(p for p in state['purchases'] if p['user_id']==alice['userId'])
cpurchase=next(p for p in state['purchases'] if p['user_id']==charlie['userId'])
forest=colors.HexColor('#72D6C2'); ink=colors.HexColor('#E6EDF5'); muted=colors.HexColor('#A4B1C0')
pale=colors.HexColor('#202C3A'); line=colors.HexColor('#334254'); paper=colors.HexColor('#111821'); rowalt=colors.HexColor('#19232E')
for name,file in [('Body','arial.ttf'),('BodyBold','arialbd.ttf'),('Display','georgia.ttf')]:
    path=Path('C:/Windows/Fonts')/file
    if path.exists():pdfmetrics.registerFont(TTFont(name,str(path)))
BODY='Body' if 'Body' in pdfmetrics.getRegisteredFontNames() else 'Helvetica'
BOLD='BodyBold' if 'BodyBold' in pdfmetrics.getRegisteredFontNames() else 'Helvetica-Bold'
DISPLAY='Display' if 'Display' in pdfmetrics.getRegisteredFontNames() else 'Times-Roman'
styles={
 'body':ParagraphStyle('body',fontName=BODY,fontSize=9.4,leading=14.2,textColor=ink,spaceAfter=9),
 'small':ParagraphStyle('small',fontName=BODY,fontSize=8,leading=11.5,textColor=muted,spaceAfter=6),
 'h1':ParagraphStyle('h1',fontName=DISPLAY,fontSize=28,leading=33,textColor=forest,spaceAfter=13),
 'h2':ParagraphStyle('h2',fontName=BOLD,fontSize=12,leading=17,textColor=forest,spaceBefore=13,spaceAfter=7,keepWithNext=True),
 'eyebrow':ParagraphStyle('eyebrow',fontName=BOLD,fontSize=8,leading=12,textColor=muted,spaceAfter=9),
 'cell':ParagraphStyle('cell',fontName=BODY,fontSize=8.1,leading=11.5,textColor=ink),
 'th':ParagraphStyle('th',fontName=BOLD,fontSize=8.1,leading=11.5,textColor=colors.HexColor('#101720')),
 'cover':ParagraphStyle('cover',fontName=DISPLAY,fontSize=39,leading=44,textColor=forest,spaceAfter=18),
 'code':ParagraphStyle('code',fontName='Courier',fontSize=7.6,leading=11,textColor=ink,backColor=pale,borderPadding=10,spaceBefore=4,spaceAfter=12),
}
story=[]
def p(text,style='body'):return Paragraph(html.escape(str(text)).replace('\n','<br/>'),styles[style])
def para(text,style='body'):story.append(p(text,style))
def h(text):story.append(p(text,'h2'))
def bullets(items):
    for text in items:story.append(Paragraph('- '+html.escape(text),styles['body']))
def code(text):
    wrapped=[]
    for row in text.strip().splitlines():wrapped.extend(textwrap.wrap(row,92,subsequent_indent='  ',replace_whitespace=False,drop_whitespace=False) or [''])
    story.append(Preformatted('\n'.join(wrapped),styles['code']))
def callout(text):
    t=Table([[p(text)]],colWidths=[507]);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),pale),('BOX',(0,0),(-1,-1),.5,line),('LEFTPADDING',(0,0),(-1,-1),13),('RIGHTPADDING',(0,0),(-1,-1),13),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),4)]));story.extend([t,Spacer(1,10)])
def table(headers,rows,widths):
    data=[[p(x,'th') for x in headers]]+[[p(x,'cell') for x in row] for row in rows]
    t=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),forest),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LINEBELOW',(0,1),(-1,-1),.4,line),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#202B38'),rowalt])]))
    story.extend([t,Spacer(1,10)])
def section(n,title,dek):
    if story:story.append(PageBreak())
    para(f'FIELDNOTES / ENGINEERING HANDOVER / {n:02d}','eyebrow');para(title,'h1');para(dek)
def shot(name,maxheight=530):
    path=EVIDENCE/name
    if path.exists():
        iw,ih=ImageReader(str(path)).getSize();w=min(507,iw);hh=w*ih/iw
        if hh>maxheight:w*=maxheight/hh;hh=maxheight
        im=Image(str(path),width=w,height=hh);im.hAlign='CENTER';story.extend([im,Spacer(1,8)])
def node(d,x,y,w,hh,title,body):
    d.add(Rect(x,y,w,hh,rx=6,ry=6,fillColor=pale,strokeColor=line,strokeWidth=1))
    d.add(String(x+w/2,y+hh-20,title,textAnchor='middle',fontName=BOLD,fontSize=10,fillColor=forest))
    for i,row in enumerate(body.split('\n')):d.add(String(x+w/2,y+hh-36-i*12,row,textAnchor='middle',fontName=BODY,fontSize=8,fillColor=ink))
def arrow(d,x1,y1,x2,y2,label=None,lx=None,ly=None):
    d.add(Line(x1,y1,x2,y2,strokeColor=muted,strokeWidth=1))
    import math
    a=math.atan2(y2-y1,x2-x1);s=5
    pts=[x2,y2,x2-s*math.cos(a-.5),y2-s*math.sin(a-.5),x2-s*math.cos(a+.5),y2-s*math.sin(a+.5)]
    d.add(Polygon(pts,fillColor=muted,strokeColor=muted))
    if label:d.add(String(lx if lx is not None else (x1+x2)/2,ly if ly is not None else (y1+y2)/2+6,label,textAnchor='middle',fontName=BODY,fontSize=7.5,fillColor=muted))
def hld():
    d=Drawing(507,335)
    node(d,163,260,180,65,'Browser / React','Supabase public key + user JWT\nNo Stripe or Zoho secrets')
    node(d,5,145,150,65,'Express API','Checkout + raw webhook\nJWT verification / retry ownership')
    node(d,190,145,130,65,'Supabase','Auth + PostgreSQL\nRLS + transactional RPCs')
    node(d,355,145,145,65,'Stripe TEST','Hosted Checkout\nSigned payment events')
    node(d,190,20,130,65,'CRM worker','Lease + retry + reconciliation\nServer credentials only')
    node(d,355,20,145,65,'Zoho Developer','Matching Deal by stable ID\nClosed Won + purchase marker')
    arrow(d,188,260,90,210,'authenticated calls',110,238)
    arrow(d,270,260,255,210,'direct reads + RLS',325,238)
    arrow(d,155,177,190,177,'RPC',172,187)
    d.add(Line(80,210,80,230,strokeColor=muted));d.add(Line(80,230,427,230,strokeColor=muted));arrow(d,427,230,427,210,'create Checkout',395,218)
    d.add(Line(427,145,427,120,strokeColor=muted));d.add(Line(427,120,80,120,strokeColor=muted));arrow(d,80,120,80,145,'signed webhook via CLI / HTTPS',160,126)
    arrow(d,255,145,255,85,'durable outbox',303,101)
    arrow(d,320,52,355,52,'GET / PUT',339,64)
    return d
def states():
    d=Drawing(507,160)
    node(d,5,80,138,60,'PENDING','Paid client already entitled\nRetry time recorded')
    node(d,184,80,138,60,'PROCESSING','2-minute lease + token\nOne claimant per job')
    node(d,363,80,138,60,'SYNCED','Receipt reconciled or written\nNo further claims')
    arrow(d,143,110,184,110,'claim',164,120);arrow(d,322,110,363,110,'success',343,120)
    d.add(Line(250,80,250,40,strokeColor=muted));d.add(Line(250,40,73,40,strokeColor=muted));arrow(d,73,40,73,80,'failure / expired lease -> retry',160,23)
    return d

section(1,'Paid Client Access','Architecture, testing, and interview guide | Senior Full-Stack Integration Engineer assessment')
para('Verified payments.\nPrivate documents.\nResilient CRM sync.','cover')
callout('Implemented and tested locally with Stripe test Checkout, Supabase identity and row-level security, and Zoho CRM Developer Edition (India). Only fictional clients and test card payments were used.')
table(['DELIVERABLE','WHERE TO FIND IT'],[
 ('Running portal','http://localhost:4242'),('Source project','E:/knowbal - README.md, server/, web/, tests/, scripts/'),('Database setup','supabase/migrations/001 through 003, run in order'),('Evidence','docs/evidence/ - real provider references and test results'),('Local credentials','Ignored .env only; never include in the interview submission')],[133,374])
para('Prepared on 27 October 2026, India Standard Time. This guide describes the final Developer Edition integration. Earlier Enterprise trial records were preserved as historical fixtures; they are not the final environment.','small')
h('How to read this guide')
para('Start with requirement coverage and the local run instructions. Use the HLD to explain boundaries, the LLD to explain data correctness, and the test/runbook pages to demonstrate behavior. The closing pages provide interview answers, limitations, and a timed walkthrough.')

section(2,'Assessment coverage','Every substantive requirement from the supplied assessment is mapped to implementation and verification.')
table(['REQUIREMENT / EXPECTATION','IMPLEMENTATION AND CHECK'],[
 ('Stripe sandbox + Supabase test data + Zoho Developer Edition','Configured test Stripe account, pac_* schema, fictional dev- clients, and Developer Account Deal bindings. Final provider evidence is on the evidence page.'),
 ('Verify payment webhook and match the correct client/Deal with stable IDs','Raw-body Stripe SDK signature verification. User, purchase, document, session, Deal and CRM environment are checked. Price/currency are snapshots, not browser inputs.'),
 ('Grant access only after successful payment','Paid test Checkout event required. Purchase + entitlement + event receipt + CRM job commit in one PostgreSQL transaction. A decline or redirect grants nothing.'),
 ('Repeated webhook creates no second entitlement or Zoho update','Unique event receipt, paid-purchase gate, unique entitlement and job. Five concurrent replays of a real event checked against unchanged Zoho state.'),
 ('Zoho failure does not break paid access; pending sync and retry','Durable job and persisted error. HTTP 503 injected in the normal adapter test; document remains readable. Real retry completes sync.'),
 ('Portal shows access and CRM sync status','Direct Supabase reads with client JWT; five-second polling; Read document and Retry CRM sync actions.'),
 ('One client cannot retrieve another client record/document','SELECT-only client grants, ownership RLS, entitlement-aware content policy, JWT/ownership-checked retry endpoint. Paid Alice/unpaid Bob live tests.'),
 ('Browser reads access from Supabase; secrets remain server-side','Only project URL and publishable key are returned by /api/config. Privileged keys, Stripe and Zoho tokens stay in server/operator code.'),
 ('.env.example, database scripts and local README','All included. npm ci, migrations, seed, Stripe CLI listener, app start, build, and test commands are documented.'),
 ('15-minute walkthrough, engineering decisions, honesty about incomplete work','Timed demonstration, tradeoffs, debugging and limits are included. Code is intended to be explained and debugged by the candidate.'),
 ('Time / submission expectations','Assessment recommends about five hours total, including account setup, and submission within 48 hours of receipt. Confirm your actual deadline from the invitation; receipt time was not assumed.')],[183,324])

section(3,'Run and test locally','The configured workspace is E:/knowbal. Keep the two long-running processes available during the demo.')
h('1. Start the listener, then the portal')
code('cd E:\\knowbal\nnpm ci\n# Terminal 1\nnpm run stripe:listen\n# Terminal 2\nnpm run dev')
para('Open http://localhost:4242. The Stripe CLI prints a webhook signing secret. If it differs from STRIPE_WEBHOOK_SECRET in .env, update that one value and restart the portal. A dashboard webhook secret and a CLI listener secret are not interchangeable.')
h('2. Use the right fictional accounts')
table(['CLIENT','PURPOSE'],[(c['email'], 'Paid happy-path / replay baseline' if c['alias']=='alice' else 'Keep unpaid for isolation tests' if c['alias']=='bob' else 'Paid CRM outage / recovery baseline') for c in clients],[242,265])
para('The password is DEMO_PASSWORD in the local ignored .env. No password is printed in this shareable guide. Final fixtures use the dev- prefix. Earlier unprefixed trial users are historical and should not be used for the final walkthrough.')
h('3. Create a fresh purchase demonstration')
code('npm run seed -- --prefix=interview-')
para('Sign in as interview-alice@example.test with the same demo password. Use a fresh prefix for another clean demonstration. Rerunning a prefix reuses its mappings. Do not delete entitlements or rewrite a paid purchase to stage a demo.')
h('4. Run repeatable verification')
code('npm test\nnpm run build\nnpm run test:live')
para('Offline tests require no external accounts. Live checks require the running portal and the baseline paid dev-alice / unpaid dev-bob fixtures. The README contains the complete clean-machine setup.')

section(4,'Clean environment setup','Credentials are configuration. They are never part of the frontend bundle or submission archive.')
table(['SETTING','ROLE'],[
 ('SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY','Browser Supabase connection. RLS still decides which rows may be returned.'),('SUPABASE_SECRET_KEY','Server/operator admin access. Never assign it to the browser key variable.'),('STRIPE_SECRET_KEY','Must be sk_test_. Used to create hosted Checkout sessions and inspect test events.'),('STRIPE_WEBHOOK_SECRET','whsec_ from the current local listener (or a separately configured production endpoint).'),('ZOHO_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN','Server-only OAuth credentials; refresh produces short-lived access tokens.'),('ZOHO_ACCOUNTS_URL','https://accounts.zoho.in for this account.'),('ZOHO_API_URL','https://developer.zohoapis.in for the final Developer Edition; not www.zohoapis.in.'),('APP_URL / PORT','http://localhost:4242 and 4242. APP_URL is an origin without a trailing slash.'),('CRM_WORKER_ENABLED','true for normal automatic sync; false while staging the controlled outage test.'),('DEMO_PASSWORD / DEMO_EMAIL_PREFIX','Local seed/test fixture settings. Current prefix: dev-.')],[210,297])
h('Database setup')
para('Run each entire migration once, in order, in Supabase SQL Editor: 001_paid_access.sql, 002_crm_environment.sql, and 003_strict_payment_validation.sql. Transactions include the privilege changes. The prefix isolates assessment tables from unrelated data. Initial CREATE TABLE migrations are not repeatable reset scripts.')
code('psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/001_paid_access.sql\npsql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/002_crm_environment.sql\npsql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/003_strict_payment_validation.sql')
para('The optional psql route requires PostgreSQL tools and a valid direct/pooler connection. Without those, SQL Editor is sufficient. npm run seed provisions fictional identities and matching Deals after migrations and OAuth are configured.')

section(5,'High-level design','A small modular application keeps the important trust boundaries clear without adding unnecessary infrastructure.')
story.append(hld());para('Arrows describe the integration, not secret sharing. The browser never calls Zoho or Stripe secret APIs. Hosted Checkout collects payment details on Stripe.','small')
h('Why this architecture')
bullets(['React + Vite gives a compact portal; Express keeps raw webhook handling and the server boundary explicit. TypeScript makes the request and adapter code easier to inspect.', 'Supabase supplies both identity and PostgreSQL authorization. The browser reads access directly, as required, and RLS protects the same data regardless of which UI is used.', 'A PostgreSQL outbox avoids a second queue service for this exercise. Access and pending CRM work share one local transaction, so a CRM outage cannot leave a paid client locked out.', 'The worker runs in the server process for local simplicity, but its database leases allow it to be separated into supervised workers later. No durability depends on an in-memory queue.'])
callout('Consistency model: payment/access is strongly consistent within the Supabase transaction. CRM synchronization is eventually consistent. The portal distinguishes granted access from pending CRM sync.')

section(6,'Low-level data model','Stable identifiers and database constraints are the backbone of correctness.')
table(['TABLE','RESPONSIBILITY / INVARIANT'],[
 ('pac_clients','auth.users UUID -> immutable server-owned Deal/environment mapping. One Deal per environment/client mapping. Client may read only their own row.'),
 ('pac_documents','Public-to-authenticated catalog metadata: title, summary, integer cents and currency. No premium body here.'),
 ('pac_document_content','Premium document body, separate from the catalog. SELECT requires an entitlement for auth.uid().'),
 ('pac_purchases','Immutable client/document/Deal/environment/price snapshot plus unique Stripe session, pending/paid/expired state and timestamps. At most one pending purchase per client/document.'),
 ('pac_entitlements','Primary key (user_id, document_id). Composite foreign key binds purchase_id to the same owner and document. A duplicate event cannot create a second grant.'),
 ('pac_webhook_events','Primary key Stripe event_id. Receipt is inserted in the same transaction as the business change. Not exposed to browser clients.'),
 ('pac_crm_jobs','One row per purchase: pending/processing/synced, attempts, retry time, lease expiry/token, sanitized error and synced time. Owner may read status; cannot write it.')],[155,352])
h('Transactional server RPCs')
table(['RPC','WHAT IT DOES'],[
 ('pac_begin_purchase','Locks the client mapping, checks environment and existing entitlement, expires stale pending purchases, and reuses or creates the pending snapshot.'),
 ('pac_fulfill','Locks the purchase, validates every identity/price field with null-safe comparisons, deduplicates delivery, and atomically commits access and a CRM job.'),
 ('pac_claim_job','Claims one due job for the configured CRM environment with FOR UPDATE SKIP LOCKED; assigns a two-minute lease and random token.'),
 ('pac_finish_job','Writes success or scheduled retry only when its lease token still owns the processing attempt. Stale workers cannot overwrite a new claimant.')],[155,352])
para('All privileged functions use a fixed empty search_path and qualified table names. PUBLIC/anon/authenticated execution is revoked; service_role alone can call them.','small')

section(7,'User flow and identity chain','The browser supplies only a document UUID to checkout. Ownership, Deal selection and price are determined by trusted server/database state.')
table(['STEP','FLOW'],[
 ('1. Sign in','Supabase verifies the fictional client email/password. The browser receives a client JWT; no privileged provider key.'),
 ('2. Create purchase','Bearer JWT is verified with Supabase getUser. pac_begin_purchase locks and snapshots the mapping and price.'),
 ('3. Create/reuse Checkout','Stripe receives client_reference_id=user UUID plus purchase_id, user_id, document_id, zoho_deal_id and zoho_environment metadata. Idempotency key is pac-checkout-<purchase UUID>.'),
 ('4. Complete payment','Browser moves to Stripe hosted Sandbox Checkout. The success URL is navigation only. Closing the tab cannot change payment truth.'),
 ('5. Receive webhook','Raw signature verification precedes parsing. Paid test session identity and amount are validated; the transaction grants the entitlement and queues CRM work.'),
 ('6. Read access','The portal polls Supabase with the user JWT. A new entitlement enables the content query and Read document action.'),
 ('7. Synchronize CRM','Worker claims the same purchase, reads its exact Deal, reconciles or adds the purchase marker, and marks sync complete.'),
 ('8. Retry if needed','Access remains active. Owner can request retry; operator can use the CLI. Failed work survives app restarts in PostgreSQL.')],[115,392])
h('Final happy-path trace')
code(f"Supabase user: {alice['userId']}\nPurchase:      {purchase['id']}\nDocument:      11111111-1111-4111-8111-111111111111\nZoho Deal:     {alice['zohoDealId']}\nEnvironment:   developer\nStripe:        {purchase['stripe_session_id']}")
para('These are fictional test-record identifiers, not credentials. Use this exact chain when an interviewer asks how you know the right Deal was updated.')

section(8,'Webhook processing in detail','The endpoint is POST /api/webhook. Raw bytes are essential because Stripe signs the exact HTTP payload.')
code('Receive raw application/json body (size limited)\nVerify Stripe-Signature using the webhook secret\nReject live events\nIgnore unsupported event types and unpaid completed sessions\nRequire payment mode and a paid cs_test_ session\nValidate UUID metadata, numeric Deal ID, client reference, amount/currency\nCall pac_fulfill: lock -> validate snapshot -> dedupe -> grant + outbox\nCommit and acknowledge; CRM happens asynchronously')
h('Accepted and ignored cases')
table(['CASE','RESULT'],[
 ('checkout.session.completed, paid, test','Validate and fulfill once.'),('checkout.session.async_payment_succeeded, paid, test','Same fulfillment path; safe if a prior event already fulfilled.'),('Completed but unpaid','Acknowledge and ignore. Do not grant early.'),('Unrelated signed event','Acknowledge and ignore.'),('Missing / forged / stale signature or changed raw bytes','HTTP 400, no business writes.'),('Valid signature but identity/amount mismatch or DB failure','HTTP 500; no partial grant. Investigate and retry after correcting the cause.'),('Live event','Rejected; this deliverable intentionally supports test payments only.'),('Duplicate valid event','HTTP 200 with granted:false. No entitlement/job/CRM duplication.')],[239,268])
h('Important validation choices')
para('Amount is an integer in minor units, not a floating-point dollar amount. Currency and price are copied into the purchase before Checkout. Adaptive Pricing is explicitly disabled so an automatic local-currency conversion cannot cause a valid USD purchase to fail the exact-match check. The server also validates CRM environment, since Deal IDs alone do not identify an environment.')
para('A session-create response is saved before its URL is returned to the browser. If saving fails, the URL is not handed out; a retry reuses Stripe idempotency. A webhook arriving before the session binding is committed is safely rejected for delivery retry.','small')

section(9,'Idempotency and concurrency','Idempotency is enforced at several boundaries because an event ID alone is not a business-level invariant.')
table(['SCENARIO','GUARD'],[
 ('Repeated click or parallel checkout requests','Client-row lock + one pending purchase; Stripe create request uses the same purchase-derived idempotency key and stable parameters.'),
 ('Same event delivered repeatedly','pac_webhook_events primary key; receipt is transactional.'),
 ('Different Stripe events for the same paid session','Purchase row lock and paid-state gate prevent a second outbox job.'),
 ('Multiple payments for the same document','Unique entitlement prevents a second access row. Each real paid purchase remains an auditable payment record; duplicate-charge/refund resolution needs an explicit business policy.'),
 ('Two CRM workers','SKIP LOCKED claim and active lease prevent ordinary simultaneous processing.'),
 ('Worker crashes','Lease expiry makes the job recoverable. Random token fences stale database completion.'),
 ('CRM update succeeds, response or process is lost','Next attempt GETs the Deal and recognizes the purchase receipt marker before writing.'),
 ('A person edits the Deal concurrently','Preserve existing Description and send If-Unmodified-Since; an API conflict remains pending for a fresh read on retry.')],[204,303])
callout('Verified guarantee: normal webhook replays add no second entitlement, job or Zoho update. Five concurrent replays of the real Developer Edition payment left the Deal Description and Modified_Time unchanged.')
h('What exactly-once does not mean here')
para('Supabase and Zoho do not share a transaction. The ordinary Zoho update API has no general operation idempotency key. Read-before-write plus receipt markers and leases handle common crash/timeout cases, but cannot prove absolute exactly-once behavior under arbitrarily delayed external writes, coarse provider timestamps, or manual receipt removal. Explain this limit rather than claiming a distributed guarantee the provider cannot supply.')

section(10,'CRM failure and recovery','A failed CRM call is a synchronization problem. It does not revoke a valid paid entitlement.')
story.append(states())
para('The worker checks for due jobs every five seconds and handles at most five per tick. HTTP calls have bounded timeouts. Failure records a sanitized error and exponential backoff: 5 * 2^attempts seconds, capped at one hour. The first failure therefore schedules roughly ten seconds later.')
h('Reproduce the failure safely')
code('CRM_WORKER_ENABLED=false  # set in .env, then restart server\n# Complete a fresh Charlie Stripe TEST purchase in the portal.\nnpm run test:outage\n# In the portal: Retry CRM sync\n# Or use the exact paid purchase UUID:\nnpm run crm:retry -- PURCHASE_UUID')
para('The outage script injects an HTTP 503 transport into the same Zoho adapter and worker used normally. It does not disable the real Zoho service, alter security controls, or expose a public failure endpoint. The job persists as pending while a direct client query still reads the premium document.')
h('Observed final Developer Edition test')
table(['CHECK','OBSERVATION'],[
 ('Purchase',cpurchase['id']),('Zoho Deal',charlie['zohoDealId']),('Failure state',f"{outage['status']}; {outage['lastError']}; attempts={outage['attempts']}"),('Client content after failure','Readable with Charlie JWT; entitlement remains present'),('Recovery','Owner portal retry / normal adapter reaches the real Developer Edition Deal; final job synced'),('After demonstration','Automatic worker restored to true')],[145,362])
para('Manual retry bypasses next_attempt_at, but not another worker\'s active lease. It requires a valid owner JWT; another client gets 404. The CLI is a trusted server/operator action and must retain its credentials locally.','small')

section(11,'Authorization and secret boundaries','Hiding a button is presentation. Database policies enforce who can retrieve data.')
table(['DATA / ACTION','BROWSER RIGHTS'],[
 ('Catalog metadata','Authenticated SELECT.'),('Client mapping, purchases, entitlements, CRM status','SELECT only for auth.uid() = user_id. Clients cannot alter mapping, payment or sync state.'),('Premium document content','SELECT only when an entitlement exists for the current user and document.'),('Webhook receipts','No anon/authenticated table grants.'),('Server RPCs','No client EXECUTE grants; service_role only.'),('Checkout/retry API','Bearer identity verified by Supabase; retry additionally queries the paid purchase under owner RLS.'),('Privileged credentials','Ignored server .env; config response contains only URL + publishable key. Startup rejects a service key supplied as the public key.'),('Frontend source / files','Production serves dist only. Development denies .env, server, scripts, migrations, tests, docs and evidence paths. Premium content is not in the client bundle.')],[190,317])
h('Additional controls')
bullets(['Helmet adds security headers and a content security policy. Production scripts use the same-origin policy; development permits the Vite tooling it needs.', 'Non-GET API requests with an unexpected Origin are rejected. Bearer tokens avoid ambient cookie authorization; rate limiting bounds normal API use.', 'Auth changes clear client-visible purchase/content state. Pending reads are checked against the active user before updating the UI; stale data cannot be carried into another client session.', 'Structured server logs use event/purchase IDs and attempt outcomes. Provider tokens and raw sensitive error bodies are not logged.'])
callout('RLS is authorization, not DRM. An authorized reader can copy content they can read. Large file delivery would use private Supabase Storage with entitlement-aware policies or short-lived downloads.')

section(12,'Manual acceptance test plan','Use the actual portal plus provider dashboards. Record the purchase UUID so every observation is traceable.')
table(['TEST','ACTION / EXPECTED RESULT'],[
 ('Happy path','Fresh prefixed Alice signs in -> locked document -> Unlock -> Stripe Sandbox -> 4242 card -> paid -> granted -> synced -> Read document opens content.'),
 ('Decline','Fresh client uses 4000 0000 0000 0002. Stripe shows decline; purchase stays pending; entitlement count remains zero.'),
 ('Cancelled Checkout','Return via Back or cancellation. No paid webhook means no entitlement. Pending Checkout can be reused.'),
 ('Redirect tampering','Visit /?checkout=success without paying. A banner, if applicable, is informational. RLS still returns no document body.'),
 ('Cross-client records','With unpaid Bob JWT, query Alice purchase UUID, entitlement and job. All are absent; retry for Alice returns 404.'),
 ('Cross-client document','Bob selects pac_document_content directly. No premium content is returned, even if the UI is bypassed.'),
 ('Self-upgrade attempt','Bob tries to INSERT an entitlement, UPDATE a mapping/price, or invoke pac_claim_job. Database privileges reject the action.'),
 ('Repeated delivery','Run npm run test:live. Five locally re-signed replays of the real Stripe event return granted:false; counts and Zoho state stay unchanged.'),
 ('Bad signature','POST unsigned JSON to /api/webhook -> 400, no state change. Offline tests also cover altered bytes and stale timestamps.'),
 ('CRM outage','Disable worker before fresh payment; run test:outage -> pending + readable content; owner retries -> synced.'),
 ('Restart / crash','Offline DB tests expire a processing lease and recover it. A stale completion token is rejected.'),
 ('Environment mismatch','A trial client cannot create a Developer Edition purchase. Worker claims only its configured CRM environment.')],[148,359])
para('For Stripe success use 4242 4242 4242 4242, any future expiry (for example 12/30), any 3-digit CVC, and fictional contact/name fields. Do not use a real payment method or save the test card.','small')

section(13,'Automated test evidence','Tests were run against both the implementation and the real connected test services.')
table(['LEVEL','VERIFICATION'],[
 ('Offline suite',f"{state['offlineTests']} passing tests: real PostgreSQL via PGlite for RLS/transactions, Express HTTP boundaries, Stripe SDK signature validation, Zoho adapter failure/reconciliation."),
 ('Build','TypeScript noEmit check and Vite production build passed. Dependency audit recorded in the final source validation.'),
 ('Live services',f"{len(live['results'])} checks passed using final Developer Edition fixtures: Supabase user queries, Stripe actual paid session/event, Zoho real Deal state, replay deduplication and protected file paths."),
 ('Failure demonstration','A real paid Developer Edition client retained content access during injected Zoho 503; the pending job recovered through a normal real provider update.'),
 ('Browser verification','Hosted Stripe test checkout, paid document reader, CRM status, owner retry UI, and responsive portal inspected. Screenshots are included in the evidence folder.')],[137,370])
h('What the live replay test actually does')
para('It fetches the event already received for Alice\'s real Stripe test payment, serializes the event, generates a local Stripe-compatible signature with the listener secret, and sends five concurrent POSTs to the local webhook. It then checks the unique entitlement and job and compares the actual Zoho Deal modification timestamp and Description before/after. The original purchase was delivered by the real Stripe CLI listener. The replay POSTs are local test deliveries, not five new Stripe-origin events.')
h('Evidence files')
bullets(['docs/evidence/live-results.json: final live check list and provider reference IDs.', 'docs/evidence/current-state.json: sanitized client/purchase/job/provider snapshot; no tokens.', 'docs/evidence/outage-pending.json and outage-recovered.json: failure and recovery observations.', 'docs/evidence/portal-paid.png, portal-pending.png and portal-reader.png: final client UI states.', 'docs/evidence/trial-*.json: earlier trial-account observations preserved separately.'])
para('PGlite executes PostgreSQL semantics with explicit test roles and an auth.uid fixture. It complements, rather than replaces, the live Supabase JWT/RLS tests. Signed delayed-success fixtures are tested; real browser payments use card Checkout.','small')

section(14,'Verified portal','The final happy-path client sees document access and CRM sync independently, with the same persisted purchase reference.')
shot('portal-paid.png',545)
para('Final Developer Edition screenshot: paid Alice, unlocked document, completed CRM sync, and owner purchase activity. Status and document content are queried from Supabase, not inferred from the return URL.','small')

section(15,'Read and recover','The reader is backed by the entitlement policy. CRM failures have their own visible, recoverable state.')
shot('portal-pending.png',325)
para('Pending screenshot: payment confirmed and access granted while CRM sync remains pending. Retry is scoped to the paid purchase owner.','small')
shot('portal-reader.png',210)
para('The premium body is fetched only after Read document is selected. It is not preloaded in the catalog or embedded in the frontend bundle.','small')

section(16,'Code walkthrough and interview answers','Use a few concrete invariants to explain the implementation without memorizing every line.')
table(['QUESTION','ANSWER TO PRACTICE'],[
 ('Why not grant access on success_url?','Anyone can visit a URL, and a paying client might close the tab. The verified provider event is the payment boundary; the browser later reads Supabase truth.'),
 ('Why stable IDs instead of email?','Email can change, collide or be entered differently at checkout. Supabase UUID, purchase UUID, Stripe session, Deal ID and environment form an explicit auditable chain.'),
 ('Why a transaction/outbox?','Without it, a crash could grant access but lose CRM work, or record an event without granting access. The transaction commits all local effects together; remote CRM is retried separately.'),
 ('Why both event and entitlement uniqueness?','An event ID deduplicates a delivery; a document entitlement is a business invariant. Different events can refer to one payment and must still result in one grant.'),
 ('What if Zoho is down?','Entitlement is already committed. Persist pending work with a safe error, attempt count and retry time. The UI can retry; the worker also retries automatically.'),
 ('How do two workers avoid duplicates?','Claim locks use SKIP LOCKED, a bounded lease and a random token. Fenced completion rejects stale workers. Receipt reconciliation handles ambiguous external success.'),
 ('Can service_role leak through RLS?','It bypasses RLS, so it must stay server-side. The browser gets only a publishable key plus user JWT; client grants and RLS both apply.'),
 ('What is the hardest remaining correctness limit?','There is no atomic transaction between Postgres and Zoho and no generic Zoho idempotency key. We reduce and reconcile external ambiguity, and clearly state the limit.'),
 ('What did practical testing change?','Disabled automatic currency conversion to keep payment snapshot matching exact; blocked Vite source/seed file paths; separated Developer/trial ID namespaces; hardened null validation and stale auth UI reads.')],[176,331])
h('Where to point in the code')
para('server/app.ts: raw webhook registration before JSON middleware; checkout identity; owner retry. server/payments.ts: accepted payment shapes. supabase/migrations/: transactional invariants and RLS. server/worker.ts: lease claim and fenced finish. server/zoho.ts: OAuth, conditional update and receipt reconciliation. web/main.tsx: direct Supabase reads and client actions.')

section(17,'Implementation map','A source-oriented walkthrough of the finished system: where each behavior lives, what calls what, and which invariants each layer owns.')
table(['AREA / FILE','IMPLEMENTATION DETAIL'],[
 ('server/config.ts','Zod validates required URLs, port and key prefixes/roles at startup. It only permits supported Zoho regional domains. The Zoho API hostname derives a production/developer environment label so an ID from one environment cannot be used in the other.'),
 ('server/db.ts','Builds a service-role client for trusted server operations and a per-request Supabase client that carries the verified user JWT. checked() turns database errors into failed operations instead of silently treating them as empty results.'),
 ('server/app.ts','Express + Helmet, bounded request bodies, rate limits and origin checks. /api/config returns only Supabase URL/public key. Raw Stripe webhook route is registered before JSON parsing. Checkout verifies the bearer identity, asks Postgres for the price and Deal mapping, creates/reuses hosted Checkout, persists its session. Retry verifies purchase ownership using the user JWT.'),
 ('server/payments.ts','Normalizes only supported successful Stripe Checkout event types; validates paid status, test mode, required metadata, purchase/session/user/Deal/document/environment identifiers, amount and currency. It rejects incomplete, mismatched, live-mode or unpaid sessions.'),
 ('server/worker.ts','Polls durable CRM jobs every five seconds, at most five per tick. Claiming is in SQL rather than memory. The adapter failure becomes a persisted pending state; database failure is logged without exposing token/provider response content.'),
 ('server/zoho.ts','Refresh-token OAuth with a 10-second timeout, one in-flight refresh and short-lived access-token cache. API calls use the configured India Developer Edition base. Deal GET-before-PUT preserves Description, detects prior success by purchase marker, uses Modified_Time conditional write and suppresses optional triggers.'),
 ('web/main.tsx / web/styles.css','Sign-in, catalog, status, read and retry UI. Browser gets a public Supabase key and user session only. It reads rows directly under RLS, polls durable state, fetches protected document content only after a click, and handles stale asynchronous auth reads.'),
 ('supabase/migrations/001-003','Create isolated pac_* tables, unique/foreign-key invariants, views/functions, grants and RLS policies; later migrations add environment binding and null-safe payment validation. Run once in numeric order.'),
 ('scripts/seed.ts','Creates fictional Supabase identities and Developer Edition Deals, stores immutable UUID-to-Deal mapping, and prints aliases only. A chosen prefix makes a clean, repeatable set of accounts. Existing identities/purchases are never reset.'),
 ('scripts/live-test.ts / outage-test.ts','Live test signs in with public-key clients, checks ownership and real provider facts, replays the existing verified event payload, and checks CRM timestamp unchanged. Outage test injects a transport-level 503 into the real adapter seam and proves the paid document is still readable.'),
 ('scripts/package-submission.py / README.md','Archives source with dependency lock, scripts, migrations and .env.example, excludes private/local files and scans configured secret values before packaging. README is the operator runbook.')],[155,352])
h('Request and state sequence')
code("""1. Browser POST /api/checkout { documentId } + Bearer user JWT
2. Express calls pac_begin_purchase(user UUID, document UUID, configured CRM environment)
3. Postgres locks mapping; rejects already-owned or mismatched account; snapshots current price/Deal/environment
4. Stripe Checkout session receives stable metadata and idempotency key; session ID is saved
5. Stripe CLI forwards signed test event to POST /api/webhook (raw bytes)
6. Stripe SDK verifies signature; payments.ts validates session binding and test payment
7. pac_fulfill commits event receipt + paid purchase + entitlement + CRM job in one transaction
8. Worker claims job with lease and writes Deal marker/stage; finish RPC fences stale claims
9. Browser uses its JWT/RLS to see entitlement, document content and sync status""")
callout('The key design line: synchronous local commit at the payment boundary; asynchronous remote CRM projection after it. Do not move CRM into the webhook transaction or grant access from the browser redirect.')

section(18,'Issues encountered and how they were fixed','These are concrete integration problems observed during setup, implementation and verification, plus the architectural reason for each resolution.')
table(['ISSUE','ROOT CAUSE','RESOLUTION / LESSON'],[
 ('Zoho trial was a different org from Developer Edition','Zoho Developer Edition is a separate tenant with separate OAuth grants and record IDs. The India region also requires its matching OAuth/API domains.','Authorized Developer Edition separately, validated its Deal API, and saved zoho_environment with every Deal mapping, purchase, job and Checkout metadata. Cross-environment writes are rejected.'),
 ('Webhook signature failed if JSON was parsed first','Stripe signs exact request bytes; reconstructed JSON is not the signed payload.','Mounted express.raw before express.json, bounded the body, used the active Stripe CLI signing secret, and verified forged requests return 400 without changing state.'),
 ('Success URL is not proof of payment','A success URL is public navigation state; an unpaid visitor can open it and a paying user can close the browser.','Only supported, signed Stripe test events fulfill. Validate payment status, livemode, metadata IDs, owner, Deal, environment, session, amount and currency against the database snapshot.'),
 ('Hosted Checkout conversion can change amount/currency','Automatic currency conversion can make the presented payment differ from the fixed amount and currency stored in Postgres.','Disabled adaptive pricing for the assessment fixed price; compare integer minor units and currency to the immutable purchase snapshot.'),
 ('Redelivery and concurrent callbacks risk duplicate grants','Stripe retries; separate events can refer to one purchase; concurrent handlers race. Event ID uniqueness alone is not business idempotency.','Use unique event receipt, locked purchase state, unique entitlement and one CRM job in one transaction. Five concurrent signed replays produced no extra rows or Zoho change.'),
 ('Zoho outage could otherwise block paid access or lose sync','Postgres and Zoho cannot share one transaction. Synchronous CRM dependency makes access fragile; fire-and-forget can lose the update.','Transactional outbox grants entitlement and records pending work atomically. Injected HTTP 503 left Charlie entitled; retry performed the real Zoho update and completed sync.'),
 ('Ambiguous CRM timeout or concurrent manual edit','Zoho Deal update lacks a general idempotency key; a timeout may hide success, and unconditional writes can overwrite edits.','GET and reconcile a per-purchase receipt marker first; conditionally PUT using Modified_Time, preserve Description, and fence worker completion with lease tokens. This reduces but cannot eliminate all distributed exactly-once ambiguity.'),
 ('Bare CRM IDs are tenant-local','The same numeric-looking Deal ID is meaningful only in its Zoho org; switching hosts can target a different tenant.','Store environment with the mapping and job, bind it into Checkout, and claim/update only jobs for the configured environment.'),
 ('Service role bypasses RLS','Using the privileged Supabase client for user reads would expose all clients and documents.','Separate server admin and user JWT clients. Browser receives only public key; RLS scopes reads by auth.uid; server-only RPC grants are revoked from browser roles.'),
 ('Vite development server can expose workspace files','The development static server exposes source paths by default, including server config and SQL.','Added explicit denial for .env, server, migration and script paths; verified with live path requests and production build.'),
 ('Stale UI query can paint a previous account after sign-in changes','An in-flight request can complete after sign-out or account switch and overwrite current client state.','Ignore obsolete async reads during cleanup/session changes; keep RLS as the real authorization boundary.'),
 ('Repeatable live test needs stable controls','Resetting sample users or purchases breaks isolation evidence and makes test runs hard to reproduce.','Keep Bob unpaid as the isolation control and paid Alice/Charlie as fixtures. Seed is safe to rerun and `npm run seed -- --prefix=interview-` creates a separate set.'),
 ('Multiple provider setup steps look like app defects','The test depends on migration order, regional OAuth, a live Stripe CLI listener secret, seed state, and the portal process.','Document the ordered clean setup, two terminal processes, health check, test card, environment matching and retry runbook; keep CLI listener secret distinct from dashboard endpoint secrets.')],[130,155,222])
para('Observed test totals at handover: 21 offline tests, 9 live integration checks, production build, formatting check, and dependency audit with zero reported vulnerabilities. The real payment originated from Stripe TEST; the five replay requests were local signed replays of that actual event.','small')

section(19,'Debugging and edge cases','Trace the boundary where state stopped progressing. Do not bypass checks to make a demonstration appear successful.')
table(['SYMPTOM','CHECK / NEXT ACTION'],[
 ('Stripe paid, portal still locked','Check listener delivery and HTTP response. Confirm signing secret belongs to that listener. Find event/purchase IDs in logs; compare session binding, owner, amount/currency and environment. A DB error should roll back all local effects.'),
 ('Webhook returns 400','Missing/stale/invalid signature or changed payload. Confirm raw middleware is before express.json; use the correct whsec_ and current clock. Do not turn verification off.'),
 ('Webhook returns 500','Validation/DB operation failed. Inspect sanitized correlation IDs and database state. Generic stripe trigger fixtures lack this app\'s IDs. Repair the cause and replay the actual event.'),
 ('Access granted, CRM pending','This is the expected outage behavior. Check last_error, attempts, next_attempt_at and lease_until. Retry with the CLI or owner action.'),
 ('CRM HTTP 400 / 401 / 403','Check Developer vs Production binding and regional domain, refresh token, module scopes and record permissions. A token for the trial organization cannot simply be reused in Developer Edition.'),
 ('CRM conditional update conflict','Another actor edited the Deal. Retry after a fresh GET. Preserve the original Description and never remove the version check to overwrite blindly.'),
 ('Retry claims no work','Job may already be synced, actively leased, not due (for bulk mode), or in another CRM environment. Read the persisted row.'),
 ('Bob can see unexpected data','Check which client JWT is in use, table grants, RLS enablement and owner policies. Ensure no service secret entered the public config or frontend bundle.'),
 ('CLI stopped during a payment','A local listener is transient. Restart it, inspect the actual test event, and replay/resend appropriately. A deployed endpoint should use Stripe\'s durable event-delivery tooling and monitoring.')],[174,333])
h('Production scope to add next')
para('Managed secret storage, HTTPS/public webhook ingress, supervised workers, alerts and reconciliation jobs, controlled dead-letter handling, a unique immutable CRM receipt mechanism, refund/dispute/revocation policy, and private file storage for large documents. Multi-document catalog behavior, subscriptions, tax/discount variations and onboarding need explicit product requirements and tests.')

section(20,'15-minute interview walkthrough','Demonstrate the working path, then prove a failure boundary and explain the tradeoffs.')
table(['TIME','DEMONSTRATION'],[
 ('00:00-02:00','State the scenario and HLD. Browser -> Supabase directly; server owns provider credentials; local payment/access transaction is independent from CRM.'),
 ('02:00-05:00','Sign in to a fresh prefixed Alice. Show locked content, complete a Stripe Sandbox checkout, and return to the portal. Explain that redirect is not proof.'),
 ('05:00-07:00','Trace purchase UUID through Stripe session metadata, Supabase purchase/event/entitlement/job, and the exact Developer Edition Deal receipt.'),
 ('07:00-09:00','Run the live replay check. Show unique rows and unchanged Zoho state. Explain event-level versus business-level deduplication.'),
 ('09:00-11:00','Show unpaid Bob isolation using the live script. Explain SELECT grants, RLS and the entitlement-aware content policy.'),
 ('11:00-13:00','Show the recorded outage evidence or a staged fresh Charlie. Access stays granted; pending work retries and recovers. Keep automatic worker restored afterward.'),
 ('13:00-15:00','Explain external exactly-once limits, test coverage, deliberate scope, and production improvements. Be ready to inspect the raw webhook and transactional SQL.')],[112,395])
h('Submission checklist')
bullets(['Source, package-lock.json, .env.example, all ordered migrations, README, tests and operator scripts are included.', 'Share the generated source archive and this PDF. Supply secrets through a separate secure process only if a reviewer needs to run live integrations.', 'Do not include .env, .env.trial, OAuth grants, raw logs, node_modules, or temporary browser artifacts. No assessment submission or email was sent automatically.', 'The assessment evaluates prioritization, architecture, working integration, security/data correctness, handling of incomplete work and clarity of tradeoffs. Practice explaining and debugging the code, including where AI assistance was used.'])
h('Primary references')
refs=[('Stripe fulfillment','https://docs.stripe.com/checkout/fulfillment'),('Stripe webhook signatures','https://docs.stripe.com/webhooks/signature'),('Supabase row-level security','https://supabase.com/docs/guides/database/postgres/row-level-security'),('Zoho record update API v8','https://www.zoho.com/crm/developer/docs/api/v8/update-records.html'),('Zoho Developer Edition','https://www.zoho.com/crm/developer/docs/dev-edition.html'),('Zoho environments and regional domains','https://help.zoho.com/portal/en/community/topic/kaizen-5-environments-and-domains-in-zoho-crm-part-1-2')]
refcells=[Paragraph(f'<link href="{html.escape(url)}" color="#234E3E">{html.escape(title)}</link>',styles['small']) for title,url in refs]
rt=Table([refcells[i:i+2] for i in range(0,len(refcells),2)],colWidths=[253,254]);rt.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),1),('BOTTOMPADDING',(0,0),(-1,-1),1)]));story.append(rt)
para('Requirements source: user-supplied Senior Full-Stack Integration Engineer assessment PDF, pages 1-2.','small')

def decorate(canvas,doc):
    canvas.saveState();w,hh=A4
    canvas.setFillColor(paper);canvas.rect(0,0,w,hh,fill=1,stroke=0)
    canvas.setStrokeColor(line);canvas.line(44,hh-36,w-44,hh-36);canvas.line(44,37,w-44,37)
    canvas.setFont(BOLD,7);canvas.setFillColor(forest);canvas.drawString(44,hh-27,'FIELDNOTES  /  PAID CLIENT ACCESS')
    canvas.setFont(BODY,7);canvas.setFillColor(muted);canvas.drawString(44,24,'Assessment handover | Test data only | 27 October 2026')
    canvas.drawRightString(w-44,24,f'{doc.page:02d}');canvas.restoreState()
doc=SimpleDocTemplate(str(OUT),pagesize=A4,rightMargin=44,leftMargin=44,topMargin=54,bottomMargin=51,title='Paid Client Access - Dark Mode Implementation Deep Dive',author='Santhosh',pageCompression=1)
doc.build(story,onFirstPage=decorate,onLaterPages=decorate)
print(OUT)
