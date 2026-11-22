-- =============================================================================
-- 023  Purchase order history
--
-- Every step of a purchase order is saved with its own date and time, and who
-- did it, the way customer orders already keep a status history:
--   created          the PO is made and sent to its suppliers
--   pfi received     a supplier's PFI is uploaded (one entry per supplier)
--   paid             DMC pays a supplier (one entry per supplier)
--   goods received   the warehouse records goods for a line (every delivery)
--   status changed   the PO's own status changes, e.g. to fully delivered
--
-- The database writes these entries itself, with its own clock, whenever a PO
-- or one of its lines changes, so no screen can forget one or send a wrong
-- time. Nobody can edit or delete an entry; staff can only read them.
--
-- POs made before this script get the entries their saved times allow: when
-- each was created, when each line was fully received, and the day each
-- supplier was paid (no time of day was saved for that, so it's marked).
--
-- Safe to run more than once. The last query shows po_history_kept = true.
-- =============================================================================


create table if not exists public.purchase_order_history (
  id                 uuid primary key default gen_random_uuid(),
  purchase_order_id  uuid not null references public.purchase_orders(id) on delete cascade,
  supplier_id        uuid references public.suppliers(id) on delete set null,
  event              text not null
                     check (event in ('created', 'pfi received', 'paid', 'goods received', 'status changed')),
  details            jsonb not null default '{}'::jsonb,
  happened_at        timestamptz not null default now(),
  -- Who did it, as they were then (empty when the server or a script did it).
  done_by            uuid,
  done_by_name       text,
  done_by_role       text
);

create index if not exists purchase_order_history_by_po
  on public.purchase_order_history (purchase_order_id, happened_at);


-- Staff who can see purchase orders can read their history. No one can write
-- to it directly: only the functions below add entries.
alter table public.purchase_order_history enable row level security;

drop policy if exists "staff: read purchase order history" on public.purchase_order_history;
create policy "staff: read purchase order history" on public.purchase_order_history
  for select to authenticated
  using ((select public.has_role('admin', 'sales', 'procurement', 'warehouse', 'management')));

revoke insert, update, delete on public.purchase_order_history from anon, authenticated;
grant select on public.purchase_order_history to authenticated;


-- -----------------------------------------------------------------------------
-- A PO is created, or its status changes.
-- -----------------------------------------------------------------------------
create or replace function public.log_purchase_order_history()
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
    insert into purchase_order_history
      (purchase_order_id, event, details, happened_at, done_by, done_by_name, done_by_role)
    values
      (new.id, 'created',
       jsonb_build_object('status', new.status, 'expected_delivery_date', new.expected_delivery_date),
       coalesce(new.created_at, now()), v_by, v_name, v_role);

  elsif new.status is distinct from old.status then
    insert into purchase_order_history
      (purchase_order_id, event, details, done_by, done_by_name, done_by_role)
    values
      (new.id, 'status changed',
       jsonb_build_object('from', old.status, 'to', new.status),
       v_by, v_name, v_role);
  end if;

  return null;
end;
$$;

drop trigger if exists purchase_orders_history on public.purchase_orders;
create trigger purchase_orders_history
  after insert or update on public.purchase_orders
  for each row execute function public.log_purchase_order_history();


-- -----------------------------------------------------------------------------
-- A PO line changes: a supplier's PFI, a payment, or goods received.
--
-- A supplier's PFI and payment are saved on each of that supplier's lines in
-- one go, so only the first line of that save adds an entry (now() is the
-- same moment for the whole save).
-- -----------------------------------------------------------------------------
create or replace function public.log_purchase_order_line_history()
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

  if new.supplier_pfi_file_path is not null
     and new.supplier_pfi_file_path is distinct from old.supplier_pfi_file_path
     and not exists (
       select 1 from purchase_order_history h
       where h.purchase_order_id = new.purchase_order_id
         and h.supplier_id is not distinct from new.supplier_id
         and h.event = 'pfi received'
         and h.happened_at = now()
     ) then
    insert into purchase_order_history
      (purchase_order_id, supplier_id, event, details, done_by, done_by_name, done_by_role)
    values
      (new.purchase_order_id, new.supplier_id, 'pfi received',
       jsonb_build_object('amount', new.supplier_pfi_amount),
       v_by, v_name, v_role);
  end if;

  if new.payment_proof_path is not null
     and new.payment_proof_path is distinct from old.payment_proof_path
     and not exists (
       select 1 from purchase_order_history h
       where h.purchase_order_id = new.purchase_order_id
         and h.supplier_id is not distinct from new.supplier_id
         and h.event = 'paid'
         and h.happened_at = now()
     ) then
    insert into purchase_order_history
      (purchase_order_id, supplier_id, event, details, done_by, done_by_name, done_by_role)
    values
      (new.purchase_order_id, new.supplier_id, 'paid',
       jsonb_build_object('amount', new.payment_amount, 'payment_date', new.payment_date),
       v_by, v_name, v_role);
  end if;

  -- Every change to a line's received count is its own entry.
  if coalesce(new.received_quantity, 0) is distinct from coalesce(old.received_quantity, 0) then
    insert into purchase_order_history
      (purchase_order_id, supplier_id, event, details, done_by, done_by_name, done_by_role)
    values
      (new.purchase_order_id, new.supplier_id, 'goods received',
       jsonb_build_object(
         'item_id', new.id,
         'product_id', new.product_id,
         'before', coalesce(old.received_quantity, 0),
         'after', coalesce(new.received_quantity, 0),
         'ordered', new.ordered_quantity,
         'condition', new.received_condition),
       v_by, v_name, v_role);
  end if;

  return null;
end;
$$;

drop trigger if exists purchase_order_items_history on public.purchase_order_items;
create trigger purchase_order_items_history
  after update on public.purchase_order_items
  for each row execute function public.log_purchase_order_line_history();


-- -----------------------------------------------------------------------------
-- The entries older POs can have, from the times they saved. Also run after
-- the simulated history is loaded. Adds only what's missing, so it's safe to
-- run again.
-- -----------------------------------------------------------------------------
create or replace function public.fill_purchase_order_history()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added  integer := 0;
  v_rows   integer;
begin
  -- Created: the PO's own creation time.
  insert into purchase_order_history (purchase_order_id, event, details, happened_at)
  select po.id, 'created',
         jsonb_build_object('status', 'sent to supplier', 'expected_delivery_date', po.expected_delivery_date, 'filled_in', true),
         po.created_at
  from purchase_orders po
  where po.created_at is not null
    and not exists (
      select 1 from purchase_order_history h
      where h.purchase_order_id = po.id and h.event = 'created'
    );
  get diagnostics v_rows = row_count;
  v_added := v_added + v_rows;

  -- Paid: the payment day staff entered. No time of day was saved, so it's
  -- placed at noon and marked day_only.
  insert into purchase_order_history (purchase_order_id, supplier_id, event, details, happened_at)
  select i.purchase_order_id, i.supplier_id, 'paid',
         jsonb_build_object('amount', max(i.payment_amount), 'payment_date', max(i.payment_date),
                            'filled_in', true, 'day_only', true),
         (max(i.payment_date)::timestamp + interval '12 hours') at time zone 'Asia/Manila'
  from purchase_order_items i
  where i.payment_date is not null
    and not exists (
      select 1 from purchase_order_history h
      where h.purchase_order_id = i.purchase_order_id
        and h.supplier_id is not distinct from i.supplier_id
        and h.event = 'paid'
    )
  group by i.purchase_order_id, i.supplier_id;
  get diagnostics v_rows = row_count;
  v_added := v_added + v_rows;

  -- Goods received: when each line was fully received.
  insert into purchase_order_history (purchase_order_id, supplier_id, event, details, happened_at)
  select i.purchase_order_id, i.supplier_id, 'goods received',
         jsonb_build_object('item_id', i.id, 'product_id', i.product_id, 'before', 0,
                            'after', i.received_quantity, 'ordered', i.ordered_quantity,
                            'condition', i.received_condition, 'filled_in', true),
         i.fully_received_at
  from purchase_order_items i
  where i.fully_received_at is not null
    and not exists (
      select 1 from purchase_order_history h
      where h.purchase_order_id = i.purchase_order_id
        and h.event = 'goods received'
        and h.details ->> 'item_id' = i.id::text
    );
  get diagnostics v_rows = row_count;
  v_added := v_added + v_rows;

  -- Fully delivered: when its last line was received.
  insert into purchase_order_history (purchase_order_id, event, details, happened_at)
  select po.id, 'status changed',
         jsonb_build_object('from', null, 'to', po.status, 'filled_in', true),
         (select max(i.fully_received_at) from purchase_order_items i where i.purchase_order_id = po.id)
  from purchase_orders po
  where lower(trim(po.status)) = 'fully delivered'
    and exists (select 1 from purchase_order_items i where i.purchase_order_id = po.id)
    and not exists (
      select 1 from purchase_order_items i
      where i.purchase_order_id = po.id and i.fully_received_at is null
    )
    and not exists (
      select 1 from purchase_order_history h
      where h.purchase_order_id = po.id
        and h.event = 'status changed'
        and lower(trim(h.details ->> 'to')) = 'fully delivered'
    );
  get diagnostics v_rows = row_count;
  v_added := v_added + v_rows;

  return v_added;
end;
$$;

revoke execute on function public.fill_purchase_order_history() from public, anon, authenticated;
revoke execute on function public.log_purchase_order_history() from public, anon, authenticated;
revoke execute on function public.log_purchase_order_line_history() from public, anon, authenticated;

select public.fill_purchase_order_history() as entries_added_for_older_pos;


-- -----------------------------------------------------------------------------
-- Check: po_history_kept = true.
-- -----------------------------------------------------------------------------
select
  to_regclass('public.purchase_order_history') is not null
    and exists (select 1 from pg_trigger where tgname = 'purchase_orders_history' and not tgisinternal)
    and exists (select 1 from pg_trigger where tgname = 'purchase_order_items_history' and not tgisinternal)
    as po_history_kept,
  (select count(*) from public.purchase_order_history) as history_entries;
