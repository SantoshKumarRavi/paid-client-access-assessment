-- Null-safe identity checks preserve the same RPC signatures and permissions.
begin;
create or replace function public.pac_begin_purchase(p_user uuid,p_document uuid,p_environment text default 'production') returns public.pac_purchases
language plpgsql security definer set search_path='' as $$
declare c public.pac_clients; d public.pac_documents; p public.pac_purchases;
begin
  select * into strict c from public.pac_clients where user_id=p_user for update;
  if c.zoho_environment is distinct from p_environment then raise exception 'Client CRM environment mismatch'; end if;
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
create or replace function public.pac_fulfill(p_event text,p_purchase uuid,p_session text,p_user uuid,p_deal text,p_document uuid,p_amount integer,p_currency text,p_environment text default 'production') returns boolean
language plpgsql security definer set search_path='' as $$
declare p public.pac_purchases;
begin
  select * into strict p from public.pac_purchases where id=p_purchase for update;
  if p.stripe_session_id is distinct from p_session or p.user_id is distinct from p_user or p.zoho_deal_id is distinct from p_deal or p.document_id is distinct from p_document or p.amount_cents is distinct from p_amount or p.currency is distinct from p_currency or p.zoho_environment is distinct from p_environment then
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
commit;
