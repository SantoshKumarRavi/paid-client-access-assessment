-- Isolated assessment tables; no changes to unrelated application data.
begin;
create table public.pac_clients (
  user_id uuid primary key references auth.users(id) on delete restrict,
  zoho_deal_id text not null unique check (zoho_deal_id ~ '^[0-9]+$'),
  display_name text not null
);
create table public.pac_documents (
  id uuid primary key, title text not null, summary text not null,
  price_cents integer not null check(price_cents > 0), currency text not null check(currency ~ '^[a-z]{3}$')
);
create table public.pac_document_content (
  document_id uuid primary key references public.pac_documents(id), content text not null
);
create table public.pac_purchases (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.pac_clients(user_id),
  document_id uuid not null references public.pac_documents(id), zoho_deal_id text not null,
  amount_cents integer not null check(amount_cents>0), currency text not null,
  status text not null default 'pending' check(status in ('pending','paid','expired')),
  stripe_session_id text unique, checkout_expires_at timestamptz not null default now()+interval '25 hours',
  created_at timestamptz not null default now(), paid_at timestamptz,
  unique(id,user_id,document_id)
);
create unique index pac_one_pending_purchase on public.pac_purchases(user_id,document_id) where status='pending';
create table public.pac_entitlements (
  user_id uuid not null, document_id uuid not null, purchase_id uuid not null unique,
  granted_at timestamptz not null default now(), primary key(user_id,document_id),
  foreign key(purchase_id,user_id,document_id) references public.pac_purchases(id,user_id,document_id)
);
create table public.pac_webhook_events (
  event_id text primary key, purchase_id uuid not null references public.pac_purchases(id), received_at timestamptz not null default now()
);
create table public.pac_crm_jobs (
  purchase_id uuid primary key references public.pac_purchases(id), user_id uuid not null references public.pac_clients(user_id),
  status text not null default 'pending' check(status in ('pending','processing','synced')),
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
  lease_until timestamptz, lease_token uuid, last_error text, synced_at timestamptz
);
create index pac_crm_due on public.pac_crm_jobs(next_attempt_at) where status <> 'synced';

alter table public.pac_clients enable row level security;
alter table public.pac_documents enable row level security;
alter table public.pac_document_content enable row level security;
alter table public.pac_purchases enable row level security;
alter table public.pac_entitlements enable row level security;
alter table public.pac_webhook_events enable row level security;
alter table public.pac_crm_jobs enable row level security;
revoke all on public.pac_clients,public.pac_documents,public.pac_document_content,public.pac_purchases,public.pac_entitlements,public.pac_webhook_events,public.pac_crm_jobs from anon,authenticated;
grant select on public.pac_clients,public.pac_documents,public.pac_document_content,public.pac_purchases,public.pac_entitlements,public.pac_crm_jobs to authenticated;
grant all on public.pac_clients,public.pac_documents,public.pac_document_content,public.pac_purchases,public.pac_entitlements,public.pac_webhook_events,public.pac_crm_jobs to service_role;
create policy pac_client_self on public.pac_clients for select to authenticated using(user_id=(select auth.uid()));
create policy pac_catalog on public.pac_documents for select to authenticated using(true);
create policy pac_purchases_self on public.pac_purchases for select to authenticated using(user_id=(select auth.uid()));
create policy pac_entitlements_self on public.pac_entitlements for select to authenticated using(user_id=(select auth.uid()));
create policy pac_jobs_self on public.pac_crm_jobs for select to authenticated using(user_id=(select auth.uid()));
create policy pac_content_paid on public.pac_document_content for select to authenticated using(
  exists(select 1 from public.pac_entitlements e where e.user_id=(select auth.uid()) and e.document_id=pac_document_content.document_id)
);

-- Server-only RPCs. Locks + uniqueness enforce invariants across processes.
create function public.pac_begin_purchase(p_user uuid,p_document uuid) returns public.pac_purchases
language plpgsql security definer set search_path='' as $$
declare c public.pac_clients; d public.pac_documents; p public.pac_purchases;
begin
  select * into strict c from public.pac_clients where user_id=p_user for update;
  select * into strict d from public.pac_documents where id=p_document;
  if exists(select 1 from public.pac_entitlements where user_id=p_user and document_id=p_document) then raise exception 'Already entitled'; end if;
  update public.pac_purchases set status='expired' where user_id=p_user and document_id=p_document and status='pending' and checkout_expires_at<now();
  select * into p from public.pac_purchases where user_id=p_user and document_id=p_document and status='pending';
  if not found then
    insert into public.pac_purchases(user_id,document_id,zoho_deal_id,amount_cents,currency)
    values(p_user,p_document,c.zoho_deal_id,d.price_cents,d.currency) returning * into p;
  end if;
  return p;
end $$;

create function public.pac_fulfill(p_event text,p_purchase uuid,p_session text,p_user uuid,p_deal text,p_document uuid,p_amount integer,p_currency text) returns boolean
language plpgsql security definer set search_path='' as $$
declare p public.pac_purchases;
begin
  select * into strict p from public.pac_purchases where id=p_purchase for update;
  if p.stripe_session_id is distinct from p_session or p.user_id<>p_user or p.zoho_deal_id<>p_deal or p.document_id<>p_document or p.amount_cents<>p_amount or p.currency<>p_currency then
    raise exception 'Payment identity or amount mismatch';
  end if;
  insert into public.pac_webhook_events(event_id,purchase_id) values(p_event,p.id) on conflict do nothing;
  if not found then return false; end if;
  if p.status='paid' then return false; end if;
  update public.pac_purchases set status='paid',paid_at=now() where id=p.id;
  insert into public.pac_entitlements(user_id,document_id,purchase_id) values(p.user_id,p.document_id,p.id) on conflict(user_id,document_id) do nothing;
  insert into public.pac_crm_jobs(purchase_id,user_id) values(p.id,p.user_id) on conflict do nothing;
  return true;
end $$;

create function public.pac_claim_job(p_purchase uuid default null) returns table(purchase_id uuid,user_id uuid,zoho_deal_id text,stripe_session_id text,lease_token uuid,attempts integer)
language sql security definer set search_path='' as $$
  with candidate as (
    select j.purchase_id from public.pac_crm_jobs j
    where j.status<>'synced' and (j.lease_until is null or j.lease_until<now())
    and (p_purchase is null or j.purchase_id=p_purchase)
    and (p_purchase is not null or j.next_attempt_at<=now())
    order by j.next_attempt_at for update skip locked limit 1
  ), claimed as (
    update public.pac_crm_jobs j set status='processing',lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid(),attempts=j.attempts+1
    from candidate c where j.purchase_id=c.purchase_id returning j.*
  ) select c.purchase_id,c.user_id,p.zoho_deal_id,p.stripe_session_id,c.lease_token,c.attempts
    from claimed c join public.pac_purchases p on p.id=c.purchase_id;
$$;

create function public.pac_finish_job(p_purchase uuid,p_lease uuid,p_error text default null) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update public.pac_crm_jobs set status=case when p_error is null then 'synced' else 'pending' end,
    synced_at=case when p_error is null then now() else null end,last_error=p_error,
    next_attempt_at=now()+make_interval(secs=>least(3600, (5*power(2,least(attempts,9)))::integer)),lease_until=null,lease_token=null
    where purchase_id=p_purchase and lease_token=p_lease and status='processing';
  return found;
end $$;
revoke all on function public.pac_begin_purchase(uuid,uuid),public.pac_fulfill(text,uuid,text,uuid,text,uuid,integer,text),public.pac_claim_job(uuid),public.pac_finish_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.pac_begin_purchase(uuid,uuid),public.pac_fulfill(text,uuid,text,uuid,text,uuid,integer,text),public.pac_claim_job(uuid),public.pac_finish_job(uuid,uuid,text) to service_role;

insert into public.pac_documents(id,title,summary,price_cents,currency) values('11111111-1111-4111-8111-111111111111','The Integration Playbook','A practical field guide to reliable payments, secure access, and resilient CRM workflows.',1900,'usd');
insert into public.pac_document_content(document_id,content) values('11111111-1111-4111-8111-111111111111',E'# The Integration Playbook\n\nA sample premium document for the Paid Client Access assessment.\n\n## 1. Trust the right boundary\nPayment redirects are navigation, not proof of payment. Verify the signature over raw bytes, validate the paid session, and bind immutable IDs.\n\n## 2. Commit access before calling CRM\nWrite payment, entitlement, event receipt and an outbox job in one database transaction. An unavailable CRM must never block a paying client.\n\n## 3. Plan for delivery more than once\nUse event IDs and business-level uniqueness. Retry external side effects with a durable lease and reconcile ambiguous outcomes.\n\n## 4. Enforce ownership in the database\nRLS protects both records and document content. A browser key never carries service privileges.\n\nYou have successfully unlocked this sample document.');
commit;
