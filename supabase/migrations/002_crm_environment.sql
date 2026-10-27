-- Provider environment is part of every immutable Deal binding.
begin;
alter table public.pac_clients add column zoho_environment text not null default 'production' check(zoho_environment in ('production','developer'));
alter table public.pac_purchases add column zoho_environment text not null default 'production' check(zoho_environment in ('production','developer'));
alter table public.pac_clients drop constraint pac_clients_zoho_deal_id_key;
alter table public.pac_clients add constraint pac_client_environment_deal unique(zoho_environment,zoho_deal_id);
drop function public.pac_begin_purchase(uuid,uuid);
create function public.pac_begin_purchase(p_user uuid,p_document uuid,p_environment text default 'production') returns public.pac_purchases
language plpgsql security definer set search_path='' as $$
declare c public.pac_clients; d public.pac_documents; p public.pac_purchases;
begin
  select * into strict c from public.pac_clients where user_id=p_user for update;
  if c.zoho_environment<>p_environment then raise exception 'Client CRM environment mismatch'; end if;
  select * into strict d from public.pac_documents where id=p_document;
  if exists(select 1 from public.pac_entitlements where user_id=p_user and document_id=p_document) then raise exception 'Already entitled'; end if;
  update public.pac_purchases set status='expired' where user_id=p_user and document_id=p_document and status='pending' and checkout_expires_at<now();
  select * into p from public.pac_purchases where user_id=p_user and document_id=p_document and status='pending';
  if not found then
    insert into public.pac_purchases(user_id,document_id,zoho_deal_id,amount_cents,currency,zoho_environment)
    values(p_user,p_document,c.zoho_deal_id,d.price_cents,d.currency,c.zoho_environment) returning * into p;
  end if;
  return p;
end $$;
drop function public.pac_fulfill(text,uuid,text,uuid,text,uuid,integer,text);
create function public.pac_fulfill(p_event text,p_purchase uuid,p_session text,p_user uuid,p_deal text,p_document uuid,p_amount integer,p_currency text,p_environment text default 'production') returns boolean
language plpgsql security definer set search_path='' as $$
declare p public.pac_purchases;
begin
  select * into strict p from public.pac_purchases where id=p_purchase for update;
  if p.stripe_session_id is distinct from p_session or p.user_id<>p_user or p.zoho_deal_id<>p_deal or p.document_id<>p_document or p.amount_cents<>p_amount or p.currency<>p_currency or p.zoho_environment<>p_environment then
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
drop function public.pac_claim_job(uuid);
create function public.pac_claim_job(p_purchase uuid default null,p_environment text default 'production') returns table(purchase_id uuid,user_id uuid,zoho_deal_id text,stripe_session_id text,lease_token uuid,attempts integer,zoho_environment text)
language sql security definer set search_path='' as $$
  with candidate as (
    select j.purchase_id from public.pac_crm_jobs j join public.pac_purchases p on p.id=j.purchase_id
    where j.status<>'synced' and (j.lease_until is null or j.lease_until<now())
    and p.zoho_environment=p_environment
    and (p_purchase is null or j.purchase_id=p_purchase)
    and (p_purchase is not null or j.next_attempt_at<=now())
    order by j.next_attempt_at for update of j skip locked limit 1
  ), claimed as (
    update public.pac_crm_jobs j set status='processing',lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid(),attempts=j.attempts+1
    from candidate c where j.purchase_id=c.purchase_id returning j.*
  ) select c.purchase_id,c.user_id,p.zoho_deal_id,p.stripe_session_id,c.lease_token,c.attempts,p.zoho_environment
    from claimed c join public.pac_purchases p on p.id=c.purchase_id;
$$;
revoke all on function public.pac_begin_purchase(uuid,uuid,text),public.pac_fulfill(text,uuid,text,uuid,text,uuid,integer,text,text),public.pac_claim_job(uuid,text) from public,anon,authenticated;
grant execute on function public.pac_begin_purchase(uuid,uuid,text),public.pac_fulfill(text,uuid,text,uuid,text,uuid,integer,text,text),public.pac_claim_job(uuid,text) to service_role;
commit;
