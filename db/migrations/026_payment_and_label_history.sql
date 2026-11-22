-- =============================================================================
-- 026  Payment history and label history
--
-- Two more things are saved with their own date and time, and who did it, the
-- way purchase orders are since 023:
--
--   Payments. Until now only an order's first payment saved a time (its
--   status changed). Every payment is now an entry: sent by the customer,
--   verified or rejected by sales, the balance included.
--
--   Label steps. A label kept only its "last updated" time, so each step
--   overwrote the one before. Every step is now an entry: original label
--   received, sent to the customer, the customer's design received, printed,
--   applied. The system can then learn how long each step takes, such as how
--   long customers take to send their designs.
--
-- The database writes these entries itself, with its own clock, whenever an
-- order's payment or a label's step changes. Nobody can edit or delete an
-- entry; staff can only read them.
--
-- Older records get the entries their saved times allow: an order's first
-- payment (sent and verified, from its status history), and a label's start
-- and latest step.
--
-- Safe to run more than once. The last query shows payments_and_labels_kept = true.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Payments
-- -----------------------------------------------------------------------------
create table if not exists public.customer_order_payment_history (
  id                 uuid primary key default gen_random_uuid(),
  customer_order_id  uuid not null references public.customer_orders(id) on delete cascade,
  event              text not null check (event in ('payment sent', 'payment verified', 'payment rejected')),
  amount             numeric,
  details            jsonb not null default '{}'::jsonb,
  happened_at        timestamptz not null default now(),
  -- Who did it, as they were then (empty when the server or a script did it).
  done_by            uuid,
  done_by_name       text,
  done_by_role       text
);

create index if not exists customer_order_payment_history_by_order
  on public.customer_order_payment_history (customer_order_id, happened_at);

alter table public.customer_order_payment_history enable row level security;

drop policy if exists "staff: read payment history" on public.customer_order_payment_history;
create policy "staff: read payment history" on public.customer_order_payment_history
  for select to authenticated
  using ((select public.has_role('admin', 'sales', 'management')));

revoke insert, update, delete on public.customer_order_payment_history from anon, authenticated;
grant select on public.customer_order_payment_history to authenticated;


create or replace function public.log_order_payment_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_by    uuid;
  v_name  text;
  v_role  text;
begin
  select id, name, lower(trim(role)) into v_by, v_name, v_role
  from profiles
  where id = auth.uid();

  -- The customer sent a payment (or replaced its proof while it waits).
  if coalesce(new.pending_payment_amount, 0) > 0
     and (coalesce(old.pending_payment_amount, 0) = 0
          or new.payment_proof_dp is distinct from old.payment_proof_dp
          or new.payment_proof_complete is distinct from old.payment_proof_complete) then
    insert into customer_order_payment_history
      (customer_order_id, event, amount, details, done_by, done_by_name, done_by_role)
    values
      (new.id, 'payment sent', new.pending_payment_amount,
       jsonb_build_object(
         'bank', new.payment_bank,
         'first', coalesce(old.settled_amount, 0) = 0,
         'in_full', coalesce(old.settled_amount, 0) + new.pending_payment_amount >= coalesce(new.total_amount, 0)),
       v_by, v_name, v_role);

  -- Sales verified it: the amount now counts as paid.
  elsif coalesce(new.settled_amount, 0) > coalesce(old.settled_amount, 0) then
    insert into customer_order_payment_history
      (customer_order_id, event, amount, details, done_by, done_by_name, done_by_role)
    values
      (new.id, 'payment verified', coalesce(new.settled_amount, 0) - coalesce(old.settled_amount, 0),
       jsonb_build_object(
         'first', coalesce(old.settled_amount, 0) = 0,
         'paid_so_far', new.settled_amount,
         'fully_paid', coalesce(new.settled_amount, 0) >= coalesce(new.total_amount, 0)),
       v_by, v_name, v_role);

  -- Sales rejected it: the waiting amount is cleared without being counted.
  elsif coalesce(old.pending_payment_amount, 0) > 0 and coalesce(new.pending_payment_amount, 0) = 0 then
    insert into customer_order_payment_history
      (customer_order_id, event, amount, details, done_by, done_by_name, done_by_role)
    values
      (new.id, 'payment rejected', old.pending_payment_amount,
       jsonb_build_object('reason', new.rejection_reason, 'first', coalesce(old.settled_amount, 0) = 0),
       v_by, v_name, v_role);
  end if;

  return null;
end;
$$;

drop trigger if exists customer_orders_payment_history on public.customer_orders;
create trigger customer_orders_payment_history
  after update on public.customer_orders
  for each row execute function public.log_order_payment_history();


-- An older order's first payment, from its status history: sent when it became
-- submitted, verified when it became payment verified. Later payments saved no
-- time, so they can't be filled in. Adds only what's missing.
create or replace function public.fill_order_payment_history()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added  integer := 0;
  v_rows   integer;
begin
  insert into customer_order_payment_history (customer_order_id, event, amount, details, happened_at)
  select o.id, 'payment sent', o.down_payment_amount,
         jsonb_build_object('first', true, 'filled_in', true),
         h.sent_at
  from customer_orders o
  join (
    select customer_order_id, min(changed_at) as sent_at
    from customer_order_status_history
    where lower(trim(new_status)) = 'submitted'
    group by customer_order_id
  ) h on h.customer_order_id = o.id
  where not exists (
    select 1 from customer_order_payment_history p
    where p.customer_order_id = o.id and p.event = 'payment sent'
  );
  get diagnostics v_rows = row_count;
  v_added := v_added + v_rows;

  insert into customer_order_payment_history (customer_order_id, event, amount, details, happened_at)
  select o.id, 'payment verified', o.down_payment_amount,
         jsonb_build_object('first', true, 'filled_in', true),
         h.verified_at
  from customer_orders o
  join (
    select customer_order_id, min(changed_at) as verified_at
    from customer_order_status_history
    where lower(trim(new_status)) = 'payment verified'
    group by customer_order_id
  ) h on h.customer_order_id = o.id
  where not exists (
    select 1 from customer_order_payment_history p
    where p.customer_order_id = o.id and p.event = 'payment verified'
  );
  get diagnostics v_rows = row_count;
  v_added := v_added + v_rows;

  return v_added;
end;
$$;


-- -----------------------------------------------------------------------------
-- Label steps
-- -----------------------------------------------------------------------------
create table if not exists public.label_exchange_history (
  id            uuid primary key default gen_random_uuid(),
  exchange_id   uuid not null references public.compliance_label_exchanges(id) on delete cascade,
  from_status   text,
  to_status     text,
  details       jsonb not null default '{}'::jsonb,
  happened_at   timestamptz not null default now(),
  done_by       uuid,
  done_by_name  text,
  done_by_role  text
);

create index if not exists label_exchange_history_by_exchange
  on public.label_exchange_history (exchange_id, happened_at);

alter table public.label_exchange_history enable row level security;

drop policy if exists "staff: read label history" on public.label_exchange_history;
create policy "staff: read label history" on public.label_exchange_history
  for select to authenticated
  using ((select public.has_role('admin', 'sales', 'procurement', 'warehouse', 'management')));

revoke insert, update, delete on public.label_exchange_history from anon, authenticated;
grant select on public.label_exchange_history to authenticated;


create or replace function public.log_label_exchange_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_by    uuid;
  v_name  text;
  v_role  text;
begin
  select id, name, lower(trim(role)) into v_by, v_name, v_role
  from profiles
  where id = auth.uid();

  if tg_op = 'INSERT' then
    insert into label_exchange_history
      (exchange_id, from_status, to_status, happened_at, done_by, done_by_name, done_by_role)
    values
      (new.id, null, new.status, coalesce(new.created_at, now()), v_by, v_name, v_role);

  elsif new.status is distinct from old.status then
    insert into label_exchange_history
      (exchange_id, from_status, to_status, done_by, done_by_name, done_by_role)
    values
      (new.id, old.status, new.status, v_by, v_name, v_role);
  end if;

  return null;
end;
$$;

drop trigger if exists compliance_label_exchanges_history on public.compliance_label_exchanges;
create trigger compliance_label_exchanges_history
  after insert or update on public.compliance_label_exchanges
  for each row execute function public.log_label_exchange_history();


-- An older label's start (its step then isn't known) and its latest step, from
-- its two saved times. Adds only to labels with no history yet.
create or replace function public.fill_label_exchange_history()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added  integer;
begin
  with without_history as (
    select e.id, e.status, e.created_at, e.updated_at
    from compliance_label_exchanges e
    where e.created_at is not null
      and not exists (select 1 from label_exchange_history h where h.exchange_id = e.id)
  )
  insert into label_exchange_history (exchange_id, from_status, to_status, details, happened_at)
  -- Its start. With no later change, that's also its only step.
  select id, null,
         case when updated_at is null or updated_at <= created_at then status end,
         jsonb_build_object('filled_in', true),
         created_at
  from without_history
  union all
  -- Its latest step, when it changed after it started.
  select id, null, status, jsonb_build_object('filled_in', true), updated_at
  from without_history
  where updated_at > created_at;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;


revoke execute on function public.log_order_payment_history() from public, anon, authenticated;
revoke execute on function public.fill_order_payment_history() from public, anon, authenticated;
revoke execute on function public.log_label_exchange_history() from public, anon, authenticated;
revoke execute on function public.fill_label_exchange_history() from public, anon, authenticated;

select
  public.fill_order_payment_history() as payment_entries_added_for_older_orders,
  public.fill_label_exchange_history() as label_entries_added_for_older_labels;


-- -----------------------------------------------------------------------------
-- Check: payments_and_labels_kept = true.
-- -----------------------------------------------------------------------------
select
  to_regclass('public.customer_order_payment_history') is not null
    and to_regclass('public.label_exchange_history') is not null
    and exists (select 1 from pg_trigger where tgname = 'customer_orders_payment_history' and not tgisinternal)
    and exists (select 1 from pg_trigger where tgname = 'compliance_label_exchanges_history' and not tgisinternal)
    as payments_and_labels_kept,
  (select count(*) from public.customer_order_payment_history) as payment_entries,
  (select count(*) from public.label_exchange_history) as label_entries;
