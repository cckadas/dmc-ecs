-- =============================================================================
-- 034: Rush shipment — ship what's in now, the rest goes with the next order
--
-- DMC's rule (2026-11-20). When some suppliers haven't delivered and the
-- customer wants their order shipped now, the CUSTOMER asks for a rush
-- shipment. They are shown what ships now (every case already in DMC's
-- warehouse) and what waits, and what that means; then they agree, or keep
-- waiting as before. If they agree:
--   - only the cases in the warehouse go in this order's container;
--   - the rest is not shipped on its own: when it arrives, DMC keeps it and puts
--     it in the container of the customer's NEXT order (whenever that is);
--   - this order's price and balance don't change, and the waiting goods aren't
--     charged again;
--   - it can't be undone.
-- The agreement (who, when, the exact words, what ships and what waits) is
-- recorded by the database and can't be changed by anyone; the customer and
-- DMC both see it.
--
-- New order status "partly shipped": its container left without the waiting
-- goods. It becomes "shipped" once they leave with the next order.
--
-- The next order: the waiting goods are added to the customer's next
-- quotation as lines at ₱0 ("already paid"), so its container is chosen to fit
-- them; approving that quotation joins them to the new order. They can join
-- only one order, of the same customer, in the right quantity, and a quotation
-- made after the agreement can't leave them out. They need no new purchase
-- order (they're on the first order's). That order moves on to the warehouse
-- only once its own goods AND the waiting goods are all in (or the customer
-- rushes it too). If that order is cancelled (its down payment never came), the
-- waiting goods aren't lost: they wait again, for the order after it.
--
-- A partly shipped order's container can arrive: its arrival is recorded as
-- for a shipped order, counted from the day its own container left.
--
-- Racks: a case that has left in a container no longer takes a rack, so racks
-- are now freed case by case for orders split this way, and receiving the rest
-- of a line asks for racks only for the cases still in the warehouse.
--
-- Every change below happens inside the database's own steps. Nobody can set a
-- rush split, a waiting line or a loaded count by hand. Orders that are never
-- rushed work exactly as before. Safe to run more than once.
-- =============================================================================


-- 1. New details on order lines and purchase order lines ------------------------
-- ship_quantity     cases of the line in this order's container (rushed orders;
--                   empty = all of it, as always)
-- carried_from_item_id  the earlier order's line whose waiting cases this is
-- po_item_id, cases_before  where those cases are: that purchase order line,
--                   after the cases of it that left with earlier shipments
-- cases_loaded      cases of a purchase order line already loaded into a
--                   container (they no longer take a rack)
alter table public.customer_order_items
  add column if not exists ship_quantity integer,
  add column if not exists carried_from_item_id uuid,
  add column if not exists po_item_id uuid,
  add column if not exists cases_before integer not null default 0;

alter table public.quotation_items
  add column if not exists carried_from_item_id uuid;

alter table public.purchase_order_items
  add column if not exists cases_loaded integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customer_order_items_ship_quantity_check') then
    alter table public.customer_order_items
      add constraint customer_order_items_ship_quantity_check
      check (ship_quantity is null or (ship_quantity >= 0 and ship_quantity <= quantity));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'customer_order_items_carried_from_fkey') then
    alter table public.customer_order_items
      add constraint customer_order_items_carried_from_fkey
      foreign key (carried_from_item_id) references public.customer_order_items (id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'customer_order_items_po_item_fkey') then
    alter table public.customer_order_items
      add constraint customer_order_items_po_item_fkey
      foreign key (po_item_id) references public.purchase_order_items (id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'quotation_items_carried_from_fkey') then
    alter table public.quotation_items
      add constraint quotation_items_carried_from_fkey
      foreign key (carried_from_item_id) references public.customer_order_items (id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'purchase_order_items_cases_loaded_check') then
    alter table public.purchase_order_items
      add constraint purchase_order_items_cases_loaded_check check (cases_loaded >= 0);
  end if;
end;
$$;

-- Waiting cases join exactly one later order.
create unique index if not exists customer_order_items_carried_once
  on public.customer_order_items (carried_from_item_id)
  where carried_from_item_id is not null;


-- 2. Only the database's own steps set these ---------------------------------------
-- The steps below switch dmc.rush_step on for their own changes; anything else
-- (a screen, the API, a hand-made change) is refused. The server and the SQL
-- editor (no signed-in user) aren't held to it.
create or replace function public.protect_rush_details()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or coalesce(current_setting('dmc.rush_step', true), '') = 'on' then
    return new;
  end if;

  if tg_table_name = 'customer_order_items' then
    if (tg_op = 'INSERT' and (new.ship_quantity is not null or new.carried_from_item_id is not null
                              or new.po_item_id is not null or coalesce(new.cases_before, 0) <> 0))
       or (tg_op = 'UPDATE' and (new.ship_quantity is distinct from old.ship_quantity
                                 or new.carried_from_item_id is distinct from old.carried_from_item_id
                                 or new.po_item_id is distinct from old.po_item_id
                                 or new.cases_before is distinct from old.cases_before)) then
      raise exception 'A rush shipment''s details are set by the system only.';
    end if;
  elsif tg_table_name = 'purchase_order_items' then
    if (tg_op = 'INSERT' and coalesce(new.cases_loaded, 0) <> 0)
       or (tg_op = 'UPDATE' and new.cases_loaded is distinct from old.cases_loaded) then
      raise exception 'The cases loaded into containers are counted by the system only.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists customer_order_items_rush_details on public.customer_order_items;
create trigger customer_order_items_rush_details
  before insert or update on public.customer_order_items
  for each row execute function public.protect_rush_details();

drop trigger if exists purchase_order_items_cases_loaded on public.purchase_order_items;
create trigger purchase_order_items_cases_loaded
  before insert or update on public.purchase_order_items
  for each row execute function public.protect_rush_details();


-- The customer's own agreement moves their order on (the payment rule from 004
-- and 016 would otherwise refuse a customer changing an order's status). As in
-- 016, with that one exception.
create or replace function public.protect_order_payments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     text := public.my_role();
  v_allowed  text[] := array['pending_payment_amount', 'payment_bank', 'payment_proof_dp', 'payment_proof_complete', 'status'];
begin
  -- The server and the SQL editor have no signed-in user.
  if auth.uid() is null then
    return new;
  end if;

  -- A rush shipment agreed through agree_rush_shipment (only its status changes).
  if coalesce(current_setting('dmc.rush_step', true), '') = 'on'
     and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
    return new;
  end if;

  if v_role = 'customer' then
    if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
      raise exception 'Only DMC staff can confirm payments or change an order''s amounts.';
    end if;

    if new.status is distinct from old.status
       and not (
         lower(trim(new.status)) = 'submitted'
         and lower(trim(old.status)) in ('pending payment', 'payment rejected')
       ) then
      raise exception 'Customers cannot change an order to %.', new.status;
    end if;

    return new;
  end if;

  if v_role is distinct from 'admin' and v_role is distinct from 'sales' and (
    new.settled_amount is distinct from old.settled_amount
    or new.total_amount is distinct from old.total_amount
    or new.subtotal is distinct from old.subtotal
    or new.shipping_cost is distinct from old.shipping_cost
    or new.container_size is distinct from old.container_size
    or new.container_cost is distinct from old.container_cost
    or new.down_payment_amount is distinct from old.down_payment_amount
    or new.customer_id is distinct from old.customer_id
  ) then
    raise exception 'Only sales or admin can confirm payments or change an order''s amounts.';
  end if;

  return new;
end;
$$;


-- 3. The agreement, as the customer agreed to it -------------------------------------
create table if not exists public.order_rush_agreements (
  id uuid primary key default gen_random_uuid(),
  customer_order_id uuid not null unique references public.customer_orders (id) on delete cascade,
  customer_id uuid not null,
  agreed_by uuid not null,
  agreed_by_name text,
  agreed_at timestamptz not null default now(),
  terms text not null,
  lines jsonb not null,
  cases_now integer not null,
  cases_waiting integer not null
);

alter table public.order_rush_agreements enable row level security;
revoke insert, update, delete on public.order_rush_agreements from anon, authenticated;

drop policy if exists "customer: read own rush agreements" on public.order_rush_agreements;
create policy "customer: read own rush agreements" on public.order_rush_agreements
  for select to authenticated
  using (customer_id = auth.uid());

drop policy if exists "staff: read rush agreements" on public.order_rush_agreements;
create policy "staff: read rush agreements" on public.order_rush_agreements
  for select to authenticated
  using ((select public.has_role('admin', 'sales', 'procurement', 'warehouse', 'management')));


-- 4. Where a line's cases are, and how many are in ----------------------------------
-- A line's goods: its own order's purchase order line for that product, or, for
-- waiting goods carried from an earlier order, the earlier order's line, after
-- the cases of it that left with earlier shipments.
create or replace function public.order_item_line(p_item_id uuid)
returns table (po_item_id uuid, cases_before integer)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(i.po_item_id, (
           select l.id
           from purchase_order_items l
           join purchase_orders p on p.id = l.purchase_order_id
           where p.customer_order_id = i.customer_order_id and l.product_id = i.product_id
           order by l.created_at, l.id
           limit 1)),
         case when i.po_item_id is null then 0 else i.cases_before end
  from customer_order_items i
  where i.id = p_item_id
$$;

-- How many of a line's cases have arrived.
create or replace function public.item_cases_in(p_item_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, least(i.quantity, coalesce(l.received_quantity, 0) - x.cases_before))::integer
  from customer_order_items i
  cross join lateral public.order_item_line(i.id) x
  left join purchase_order_items l on l.id = x.po_item_id
  where i.id = p_item_id
$$;

-- How many of an order's cases haven't arrived yet.
create or replace function public.order_cases_waiting(p_customer_order_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(i.quantity - public.item_cases_in(i.id)), 0)::integer
  from customer_order_items i
  where i.customer_order_id = p_customer_order_id
$$;

revoke execute on function public.order_item_line(uuid) from public, anon, authenticated;
revoke execute on function public.item_cases_in(uuid) from public, anon, authenticated;
revoke execute on function public.order_cases_waiting(uuid) from public, anon, authenticated;


-- 5. The words the customer agrees to ---------------------------------------------------
create or replace function public.rush_terms(p_order_number text)
returns text
language sql
immutable
as $$
  select format(
'Rush shipment for %1$s

1. Only the goods under "Ships now" go in this order''s container. They are labeled, loaded and shipped as soon as they''re ready.
2. The goods under "Waits for your next order" are not shipped on their own. When they arrive, DMC keeps them and puts them in the container of your next order with DMC, whenever you place it. There is no separate date for them. If you don''t order from DMC again, they stay with DMC.
3. %1$s''s price and balance stay the same. The waiting goods are already part of %1$s, so they are not charged again on your next order. Your next order''s container is chosen to fit them too, which can make it a bigger container.
4. Once you agree, this can''t be undone.', p_order_number)
$$;


-- 6. Whether an order can be rushed, and what would ship -------------------------------
-- The reason it can't, or null.
create or replace function public.rush_refusal(p_order customer_orders, p_cases_now integer, p_cases_waiting integer)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_agreed timestamptz;
begin
  if p_order.id is null then
    return 'Order not found.';
  end if;

  if p_order.customer_id is distinct from auth.uid() or public.my_role() is distinct from 'customer' then
    return 'Only the customer who placed this order can ask for a rush shipment.';
  end if;

  select agreed_at into v_agreed from order_rush_agreements where customer_order_id = p_order.id;
  if found then
    return format('A rush shipment was already agreed for %s on %s.', p_order.order_number,
      to_char(v_agreed at time zone 'Asia/Manila', 'FMMon FMDD, YYYY'));
  end if;

  if coalesce(lower(trim(p_order.status)), '') <> 'procurement' then
    return format('A rush shipment can only be asked for while the order waits for its suppliers'' deliveries (Procurement). %s is at "%s".',
      p_order.order_number, coalesce(p_order.status, 'no status'));
  end if;

  if coalesce(p_order.settled_amount, 0) <= 0 then
    return 'The down payment must be verified first.';
  end if;

  if coalesce(p_cases_now, 0) <= 0 then
    return 'None of this order''s goods have arrived yet, so there is nothing to ship now.';
  end if;

  if coalesce(p_cases_waiting, 0) <= 0 then
    return 'All of this order''s goods have arrived: it will move on to the warehouse without a rush shipment.';
  end if;

  return null;
end;
$$;

revoke execute on function public.rush_refusal(customer_orders, integer, integer) from public, anon, authenticated;

-- What ships now and what waits, line by line, and a fingerprint of it.
create or replace function public.rush_split(p_customer_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with lines as (
    select i.id as item_id,
           p.product_name,
           p.pack_size,
           coalesce(p.unit, 'cases') as unit,
           i.quantity,
           public.item_cases_in(i.id) as ships_now,
           src.order_number as carried_from
    from customer_order_items i
    join products p on p.id = i.product_id
    left join customer_order_items s on s.id = i.carried_from_item_id
    left join customer_orders src on src.id = s.customer_order_id
    where i.customer_order_id = p_customer_order_id
  )
  select jsonb_build_object(
    'lines', coalesce(jsonb_agg(jsonb_build_object(
      'item_id', item_id, 'product', product_name, 'pack_size', pack_size, 'unit', unit,
      'cases', quantity, 'ships_now', ships_now, 'waits', quantity - ships_now,
      'carried_from', carried_from) order by product_name, item_id), '[]'::jsonb),
    'cases_now', coalesce(sum(ships_now), 0),
    'cases_waiting', coalesce(sum(quantity - ships_now), 0),
    'fingerprint', md5(coalesce(string_agg(item_id::text || ':' || ships_now || ':' || quantity, ',' order by item_id), ''))
  )
  from lines
$$;

revoke execute on function public.rush_split(uuid) from public, anon, authenticated;


-- 7. For My Orders: which of my orders could be rushed now, with the counts -------------
create or replace function public.my_rush_options()
returns table (customer_order_id uuid, cases_now integer, cases_waiting integer)
language sql
stable
security definer
set search_path = public
as $$
  select o.id,
         coalesce(sum(public.item_cases_in(i.id)), 0)::integer,
         coalesce(sum(i.quantity - public.item_cases_in(i.id)), 0)::integer
  from customer_orders o
  join customer_order_items i on i.customer_order_id = o.id
  where o.customer_id = auth.uid()
    and lower(trim(o.status)) = 'procurement'
    and coalesce(o.settled_amount, 0) > 0
    and not exists (select 1 from order_rush_agreements a where a.customer_order_id = o.id)
  group by o.id
  -- Something in to ship, and something still waiting.
  having sum(public.item_cases_in(i.id)) > 0
     and sum(i.quantity - public.item_cases_in(i.id)) > 0
$$;

revoke execute on function public.my_rush_options() from public, anon;
grant execute on function public.my_rush_options() to authenticated;


-- 8. Before agreeing: the customer sees exactly this ------------------------------------
create or replace function public.rush_shipment_preview(p_customer_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_order   customer_orders;
  v_split   jsonb;
  v_reason  text;
begin
  select * into v_order from customer_orders where id = p_customer_order_id;
  v_split := public.rush_split(p_customer_order_id);
  v_reason := public.rush_refusal(v_order, (v_split ->> 'cases_now')::integer, (v_split ->> 'cases_waiting')::integer);

  if v_reason is not null then
    raise exception '%', v_reason;
  end if;

  return v_split || jsonb_build_object(
    'order_number', v_order.order_number,
    'terms', public.rush_terms(v_order.order_number)
  );
end;
$$;

revoke execute on function public.rush_shipment_preview(uuid) from public, anon;
grant execute on function public.rush_shipment_preview(uuid) to authenticated;


-- 9. Agreeing ------------------------------------------------------------------------------
-- Only what the customer was shown: if a delivery arrived or anything changed
-- since, nothing is agreed and they're asked to look again.
create or replace function public.agree_rush_shipment(p_customer_order_id uuid, p_fingerprint text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   customer_orders;
  v_split   jsonb;
  v_reason  text;
  v_name    text;
  v_now     integer;
  v_wait    integer;
  v_staff   text;
begin
  -- Deliveries being recorded wait for this, and this for them: the lines first,
  -- then the order, as receiving does.
  perform 1
  from purchase_order_items l
  where l.id in (
    select x.po_item_id
    from customer_order_items i
    cross join lateral public.order_item_line(i.id) x
    where i.customer_order_id = p_customer_order_id
  )
  order by l.id
  for update;

  select * into v_order from customer_orders where id = p_customer_order_id for update;

  v_split := public.rush_split(p_customer_order_id);
  v_now := (v_split ->> 'cases_now')::integer;
  v_wait := (v_split ->> 'cases_waiting')::integer;
  v_reason := public.rush_refusal(v_order, v_now, v_wait);

  if v_reason is not null then
    raise exception '%', v_reason;
  end if;

  if p_fingerprint is distinct from v_split ->> 'fingerprint' then
    raise exception 'Something changed since you opened this (a delivery may have arrived). Nothing was agreed. Please look at it again.';
  end if;

  select name into v_name from profiles where id = auth.uid();

  perform set_config('dmc.rush_step', 'on', true);

  update customer_order_items i
  set ship_quantity = public.item_cases_in(i.id)
  where i.customer_order_id = p_customer_order_id;

  insert into order_rush_agreements
    (customer_order_id, customer_id, agreed_by, agreed_by_name, terms, lines, cases_now, cases_waiting)
  values
    (p_customer_order_id, v_order.customer_id, auth.uid(), v_name, public.rush_terms(v_order.order_number),
     v_split -> 'lines', v_now, v_wait);

  -- What's in moves on to the warehouse now. The step is marked as a rush in
  -- its history: the order moved on by the customer's choice, not because every
  -- delivery came, so the estimates don't learn supplier delivery times from it.
  update customer_orders set status = 'warehouse preparation' where id = p_customer_order_id;

  insert into customer_order_status_history (customer_order_id, previous_status, new_status, changed_at)
  values (p_customer_order_id, 'procurement (rush shipment)', 'warehouse preparation', now());

  perform set_config('dmc.rush_step', 'off', true);

  v_staff := format('%s: the customer agreed to a rush shipment. %s cases ship now; %s cases wait for their next order.',
    v_order.order_number, v_now, v_wait);

  begin
    insert into notifications (user_id, role, title, message, type, link, related_customer_order_id)
    values
      (v_order.customer_id, 'customer', format('%s - Rush shipment agreed', v_order.order_number),
       format('You agreed to a rush shipment for %s: %s cases ship now, and %s cases wait for your next order. Your agreement is on the order in My Orders.',
         v_order.order_number, v_now, v_wait),
       'info', '/my-orders', p_customer_order_id),
      (v_order.customer_id, 'sales', format('%s - Rush shipment agreed', v_order.order_number), v_staff, 'info', '/customer-orders', p_customer_order_id),
      (v_order.customer_id, 'warehouse', format('%s - Rush shipment: prepare what''s in', v_order.order_number), v_staff, 'info', '/compliance-label-warehouse', p_customer_order_id),
      (v_order.customer_id, 'procurement', format('%s - Rush shipment agreed', v_order.order_number), v_staff, 'info', '/purchase-orders', p_customer_order_id),
      (v_order.customer_id, 'management', format('%s - Rush shipment agreed', v_order.order_number), v_staff, 'info', '/customer-orders', p_customer_order_id);
  exception when foreign_key_violation then
    null;
  end;

  return jsonb_build_object('order_number', v_order.order_number, 'cases_now', v_now, 'cases_waiting', v_wait);
end;
$$;

revoke execute on function public.agree_rush_shipment(uuid, text) from public, anon;
grant execute on function public.agree_rush_shipment(uuid, text) to authenticated;


-- 10. A customer's waiting goods (their own, or staff) ------------------------------------
create or replace function public.waiting_goods(p_customer_id uuid)
returns table (
  item_id uuid, customer_order_id uuid, order_number text, product_id uuid, product_name text,
  pack_size text, unit text, cases integer, cbm numeric, gross_weight_kg numeric,
  agreed_at timestamptz, carried_into text, carried_into_status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_customer_id is distinct from auth.uid()
     and not public.has_role('admin', 'sales', 'procurement', 'warehouse', 'management') then
    raise exception 'You can only see your own goods.';
  end if;

  return query
  select i.id, o.id, o.order_number, i.product_id, p.product_name, p.pack_size, coalesce(p.unit, 'cases'),
         (i.quantity - i.ship_quantity)::integer, p.cbm, p.gross_weight_kg, a.agreed_at,
         nxt.order_number, nxt.status
  from customer_order_items i
  join customer_orders o on o.id = i.customer_order_id
  join order_rush_agreements a on a.customer_order_id = o.id
  join products p on p.id = i.product_id
  left join lateral (
    select o2.order_number, o2.status
    from customer_order_items c
    join customer_orders o2 on o2.id = c.customer_order_id
    where c.carried_from_item_id = i.id
  ) nxt on true
  where o.customer_id = p_customer_id
    and i.ship_quantity is not null
    and i.quantity - i.ship_quantity > 0
  order by a.agreed_at, o.order_number, p.product_name;
end;
$$;

revoke execute on function public.waiting_goods(uuid) from public, anon;
grant execute on function public.waiting_goods(uuid) to authenticated;


-- 11. Approving a quotation: the waiting goods join the new order ---------------------------
-- As in 016, plus: a quotation's ₱0 lines for waiting goods are checked (this
-- customer's, the right product and number of cases, not joined to another
-- order already), joined to the new order with where their cases are; and a
-- quotation made after an agreement can't leave that agreement's goods out.
create or replace function public.approve_quotation(p_quotation_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quotation  quotations%rowtype;
  v_request    quotation_requests%rowtype;
  v_order_id   uuid;
  v_number     text;
  v_bad        text;
  v_left_out   text;
  v_taken      text;
begin
  select * into v_quotation from quotations where id = p_quotation_id for update;

  if not found then
    raise exception 'This quotation no longer exists.';
  end if;

  select * into v_request from quotation_requests where id = v_quotation.quotation_request_id;

  if v_request.customer_id is distinct from auth.uid() then
    raise exception 'This quotation belongs to another customer.';
  end if;

  if lower(trim(v_quotation.status)) <> 'pending approval' then
    raise exception 'This quotation has already been %.', lower(trim(v_quotation.status));
  end if;

  if v_quotation.expiry_date < (now() at time zone 'Asia/Manila')::date then
    raise exception 'This quotation has expired. Please request a refreshed quote before approving.';
  end if;

  -- Its lines for waiting goods: each must be this customer's waiting cases,
  -- exactly, at ₱0.
  perform 1 from customer_order_items s
  where s.id in (select q.carried_from_item_id from quotation_items q where q.quotation_id = v_quotation.id and q.carried_from_item_id is not null)
  order by s.id
  for update;

  select string_agg(coalesce(p.product_name, 'a product'), ', ') into v_bad
  from quotation_items q
  left join customer_order_items s on s.id = q.carried_from_item_id
  left join customer_orders so on so.id = s.customer_order_id
  left join products p on p.id = q.product_id
  where q.quotation_id = v_quotation.id
    and q.carried_from_item_id is not null
    and (s.id is null
         or so.customer_id is distinct from v_request.customer_id
         or s.ship_quantity is null
         or s.product_id is distinct from q.product_id
         or q.quantity is distinct from s.quantity - s.ship_quantity
         or coalesce(q.unit_price, 0) <> 0
         or coalesce(q.subtotal, 0) <> 0);

  if v_bad is not null then
    raise exception 'This quotation''s goods from an earlier order don''t match what is waiting (%). DMC must make the quotation again.', v_bad;
  end if;

  select string_agg(distinct o2.order_number, ', ') into v_taken
  from quotation_items q
  join customer_order_items c on c.carried_from_item_id = q.carried_from_item_id
  join customer_orders o2 on o2.id = c.customer_order_id
  where q.quotation_id = v_quotation.id;

  if v_taken is not null then
    raise exception 'The goods waiting from an earlier order already go with %. DMC must make this quotation again.', v_taken;
  end if;

  -- None left out: waiting goods agreed before this quotation was made go in it.
  select string_agg(distinct w.order_number, ', ') into v_left_out
  from customer_order_items i
  join customer_orders w on w.id = i.customer_order_id
  join order_rush_agreements a on a.customer_order_id = w.id
  where w.customer_id = v_request.customer_id
    and i.ship_quantity is not null
    and i.quantity - i.ship_quantity > 0
    and a.agreed_at < v_quotation.created_at
    and not exists (select 1 from customer_order_items c where c.carried_from_item_id = i.id)
    and not exists (select 1 from quotation_items q where q.quotation_id = v_quotation.id and q.carried_from_item_id = i.id);

  if v_left_out is not null then
    raise exception 'This quotation leaves out the goods waiting from %, which go in your next order''s container. DMC must make the quotation again with them.', v_left_out;
  end if;

  v_number := next_document_number('ORD');

  insert into customer_orders (
    order_number, customer_id, quotation_id, quotation_number, subtotal, shipping_cost,
    container_size, container_cost, total_amount, down_payment_amount, delivery_location_id,
    pfi_file_path, expiry_date, status
  )
  values (
    v_number, v_request.customer_id, v_quotation.id, v_quotation.quotation_number,
    v_quotation.subtotal, v_quotation.shipping_cost, v_quotation.container_size,
    v_quotation.container_cost, v_quotation.total_amount, v_quotation.down_payment_amount,
    v_request.delivery_location_id, v_quotation.pfi_file_path, v_quotation.expiry_date,
    'pending payment'
  )
  returning id into v_order_id;

  insert into customer_order_items (customer_order_id, product_id, quantity, unit_price, subtotal)
  select v_order_id, product_id, quantity, unit_price, subtotal
  from quotation_items
  where quotation_id = v_quotation.id
    and carried_from_item_id is null;

  -- The waiting goods, with where their cases are.
  perform set_config('dmc.rush_step', 'on', true);

  insert into customer_order_items
    (customer_order_id, product_id, quantity, unit_price, subtotal, carried_from_item_id, po_item_id, cases_before)
  select v_order_id, q.product_id, q.quantity, 0, 0, s.id, x.po_item_id, x.cases_before + s.ship_quantity
  from quotation_items q
  join customer_order_items s on s.id = q.carried_from_item_id
  cross join lateral public.order_item_line(s.id) x
  where q.quotation_id = v_quotation.id;

  perform set_config('dmc.rush_step', 'off', true);

  -- The order's first step, for the progress tracker and predictions.
  insert into customer_order_status_history (customer_order_id, previous_status, new_status)
  values (v_order_id, 'quotation approved', 'pending payment');

  update quotations set status = 'approved' where id = v_quotation.id;
  update quotation_requests set status = 'approved' where id = v_request.id;

  return v_number;
end;
$$;

revoke execute on function public.approve_quotation(uuid) from public, anon;
grant execute on function public.approve_quotation(uuid) to authenticated;


-- 12. Purchase orders: waiting goods are already ordered ------------------------------------
-- As in 027, leaving out lines carried from an earlier order (their cases are on
-- that order's purchase order).
create or replace function public.create_purchase_order(
  p_customer_order_id       uuid,
  p_expected_delivery_date  date,
  p_expected_total          numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order      customer_orders%rowtype;
  v_existing   text;
  v_items      integer;
  v_no_amount  integer;
  v_missing    text;
  v_total      numeric;
  v_po         purchase_orders%rowtype;
begin
  if not public.has_role('admin', 'procurement') then
    raise exception 'Only procurement staff can create a purchase order.';
  end if;

  if p_expected_delivery_date is null then
    raise exception 'Set the expected delivery date first.';
  end if;

  -- One at a time: a second click waits here, then finds the purchase order made.
  select * into v_order from customer_orders o where o.id = p_customer_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;

  select string_agg(po.po_number, ', ' order by po.created_at, po.po_number) into v_existing
  from purchase_orders po
  where po.customer_order_id = p_customer_order_id;

  if v_existing is not null then
    raise exception '% already has a purchase order (%). Nothing was created.', v_order.order_number, v_existing;
  end if;

  if coalesce(lower(trim(v_order.status)), '') <> 'payment verified' then
    raise exception 'A purchase order can only be made once the order''s down payment is verified. % is at "%".',
      v_order.order_number, coalesce(v_order.status, 'no status');
  end if;

  -- The order's own products and quantities, each from the product's supplier
  -- at that supplier's current price-list price.
  select count(*),
         count(*) filter (where i.quantity <= 0),
         string_agg(p.product_name, ', ' order by p.product_name) filter (where l.id is null),
         sum(i.quantity * l.unit_price)
    into v_items, v_no_amount, v_missing, v_total
  from customer_order_items i
  join products p on p.id = i.product_id
  left join supplier_price_list l
    on l.supplier_id = p.supplier_id and l.product_id = p.id and l.effective_to is null
  where i.customer_order_id = p_customer_order_id
    and i.carried_from_item_id is null;

  if v_items = 0 then
    raise exception '% has no products to order.', v_order.order_number;
  end if;

  if v_no_amount > 0 then
    raise exception 'A product on % has no quantity to order.', v_order.order_number;
  end if;

  if v_missing is not null then
    raise exception 'No current supplier price for: %. Add it in Price Lists first.', v_missing;
  end if;

  if p_expected_total is not null and abs(v_total - p_expected_total) > 0.01 then
    raise exception 'A supplier''s price changed after you opened this form: the total is now %. Nothing was created. Open the form again to see the new prices.',
      '₱ ' || to_char(v_total, 'FM999,999,999,990.00');
  end if;

  -- The database gives it the next number (PO-2026-00001).
  insert into purchase_orders (customer_order_id, expected_delivery_date, status)
  values (p_customer_order_id, p_expected_delivery_date, 'sent to supplier')
  returning * into v_po;

  insert into purchase_order_items
    (purchase_order_id, product_id, supplier_id, ordered_quantity, received_quantity, unit_price, status)
  select v_po.id, i.product_id, p.supplier_id, i.quantity, 0, l.unit_price, 'sent to supplier'
  from customer_order_items i
  join products p on p.id = i.product_id
  join supplier_price_list l
    on l.supplier_id = p.supplier_id and l.product_id = p.id and l.effective_to is null
  where i.customer_order_id = p_customer_order_id
    and i.carried_from_item_id is null;

  -- The order moves on, once.
  update customer_orders
  set status = 'procurement'
  where id = p_customer_order_id;

  insert into customer_order_status_history (customer_order_id, previous_status, new_status, changed_at)
  values (p_customer_order_id, 'payment verified', 'procurement', now());

  begin
    insert into notifications (user_id, role, title, message, type, link, related_customer_order_id)
    values (
      v_order.customer_id,
      'customer',
      format('%s is now in procurement', v_order.order_number),
      format('Your order %s status is now "Procurement". Please check your order details for more information.', v_order.order_number),
      'info',
      '/my-orders',
      p_customer_order_id
    );
  exception when foreign_key_violation then
    -- The customer's account no longer exists. The purchase order still stands.
    null;
  end;

  return jsonb_build_object(
    'purchase_order_id', v_po.id,
    'po_number', v_po.po_number,
    'order_number', v_order.order_number,
    'lines', v_items,
    'total', v_total
  );
end;
$$;

revoke execute on function public.create_purchase_order(uuid, date, numeric) from public, anon;
grant execute on function public.create_purchase_order(uuid, date, numeric) to authenticated;


-- 13. Freeing racks case by case ------------------------------------------------------------
-- Takes cases of a purchase order line off its racks, oldest first, frees the
-- racks left empty, and counts them as loaded. For orders split by a rush
-- shipment, where a line's cases leave in more than one container.
create or replace function public.release_line_cases(p_line_id uuid, p_cases integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left   integer := coalesce(p_cases, 0);
  v_entry  record;
  v_racks  uuid[] := '{}';
  v_freed  integer;
begin
  if p_line_id is null or v_left <= 0 then
    return 0;
  end if;

  perform 1 from purchase_order_items where id = p_line_id for update;

  for v_entry in
    select * from purchase_order_item_racks
    where purchase_order_item_id = p_line_id
    order by created_at, id
    for update
  loop
    exit when v_left <= 0;

    if v_entry.quantity <= v_left then
      delete from purchase_order_item_racks where id = v_entry.id;
      v_left := v_left - v_entry.quantity;
    else
      update purchase_order_item_racks set quantity = quantity - v_left where id = v_entry.id;
      v_left := 0;
    end if;

    v_racks := v_racks || v_entry.warehouse_rack_id;
  end loop;

  perform set_config('dmc.rush_step', 'on', true);

  update purchase_order_items l
  set cases_loaded = l.cases_loaded + p_cases,
      warehouse_rack_id = case
        when exists (select 1 from purchase_order_item_racks r where r.purchase_order_item_id = l.id) then l.warehouse_rack_id
      end,
      updated_at = now()
  where l.id = p_line_id;

  perform set_config('dmc.rush_step', 'off', true);

  update warehouse_racks w
  set is_occupied = false, updated_at = now()
  where w.id = any(v_racks)
    and w.is_occupied
    and not exists (select 1 from purchase_order_item_racks r where r.warehouse_rack_id = w.id)
    and not exists (select 1 from purchase_order_items l where l.warehouse_rack_id = w.id);
  get diagnostics v_freed = row_count;

  return v_freed;
end;
$$;

revoke execute on function public.release_line_cases(uuid, integer) from public, anon, authenticated;

-- An order split by a rush shipment: rushed itself, or carrying waiting goods.
create or replace function public.order_is_split(p_customer_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from order_rush_agreements a where a.customer_order_id = p_customer_order_id)
      or exists (select 1 from customer_order_items i where i.customer_order_id = p_customer_order_id and i.carried_from_item_id is not null)
$$;

revoke execute on function public.order_is_split(uuid) from public, anon, authenticated;


-- 14. Receiving: racks only for the cases still here; orders move on when all is in ------
-- As in 012, plus: a line part of which already left in a container needs racks
-- only for the cases still in the warehouse; and every order waiting on this
-- line (its own order, or a later order carrying its waiting cases) moves on to
-- warehouse preparation once all of its goods are in.
create or replace function public.receive_purchase_order_item(
  p_item_id    uuid,
  p_quantity   integer,
  p_condition  text,
  p_racks      jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item       purchase_order_items%rowtype;
  v_rack       warehouse_racks%rowtype;
  v_cbm        numeric;
  v_unit       text;
  v_entry      jsonb;
  v_share      integer;
  v_placed     integer := 0;
  v_here       integer;
  v_rack_ids   uuid[] := '{}';
  v_released   uuid[];
  v_status     text;
  v_ordered    integer;
  v_received   integer;
  v_po_status  text;
  v_order_id   uuid;
  v_candidate  record;
  v_moved      boolean := false;
begin
  if not public.has_role('admin', 'warehouse') then
    raise exception 'Only warehouse staff can record deliveries.';
  end if;

  select * into v_item from purchase_order_items where id = p_item_id for update;

  if not found then
    raise exception 'This purchase order line no longer exists.';
  end if;

  if p_quantity is null or p_quantity < 0 then
    raise exception 'Please enter a valid received quantity.';
  end if;

  if p_quantity = 0 and coalesce(v_item.received_quantity, 0) = 0 then
    raise exception 'Please enter the quantity received.';
  end if;

  if p_quantity > v_item.ordered_quantity then
    raise exception 'Received quantity cannot exceed ordered quantity.';
  end if;

  -- Cases of this line already loaded into a container left the warehouse.
  if p_quantity < coalesce(v_item.cases_loaded, 0) then
    raise exception '% cases of this line have already left in a container, so the received total can''t be less than that.', v_item.cases_loaded;
  end if;

  v_here := p_quantity - coalesce(v_item.cases_loaded, 0);

  select cbm, coalesce(unit, 'unit') into v_cbm, v_unit from products where id = v_item.product_id;

  if v_here > 0 then
    -- Locked in a fixed order, so two deliveries at once wait instead of clashing.
    perform 1
    from warehouse_racks
    where id in (
      select (entry ->> 'rack_id')::uuid
      from jsonb_array_elements(coalesce(p_racks, '[]'::jsonb)) as entry
    )
    order by id
    for update;

    for v_entry in select * from jsonb_array_elements(coalesce(p_racks, '[]'::jsonb)) loop
      v_share := (v_entry ->> 'quantity')::integer;

      select * into v_rack from warehouse_racks where id = (v_entry ->> 'rack_id')::uuid;

      if not found then
        raise exception 'One of the chosen racks no longer exists.';
      end if;

      if v_share is null or v_share <= 0 then
        raise exception 'Enter how many go in rack %.', coalesce(v_rack.name, v_rack.rack_id);
      end if;

      if v_rack.id = any(v_rack_ids) then
        raise exception 'Rack % is chosen twice.', coalesce(v_rack.name, v_rack.rack_id);
      end if;

      -- A rack this line already sits in stays allowed.
      if not exists (
        select 1 from purchase_order_item_racks
        where purchase_order_item_id = p_item_id and warehouse_rack_id = v_rack.id
      ) then
        if not v_rack.is_active then
          raise exception 'Rack % is inactive and cannot be used.', coalesce(v_rack.name, v_rack.rack_id);
        end if;

        if v_rack.is_occupied then
          raise exception 'Rack % is already occupied.', coalesce(v_rack.name, v_rack.rack_id);
        end if;
      end if;

      if coalesce(v_cbm, 0) > 0 and v_share * v_cbm > v_rack.capacity_cbm then
        raise exception 'Rack % holds at most % % of this product (% m³ capacity).',
          coalesce(v_rack.name, v_rack.rack_id), floor(v_rack.capacity_cbm / v_cbm), v_unit, v_rack.capacity_cbm;
      end if;

      v_placed := v_placed + v_share;
      v_rack_ids := v_rack_ids || v_rack.id;
    end loop;

    if v_placed <> v_here then
      if coalesce(v_item.cases_loaded, 0) > 0 then
        raise exception 'The racks hold % but % are in the warehouse (% received, % already left in a container). Every case in the warehouse needs a rack.',
          v_placed, v_here, p_quantity, v_item.cases_loaded;
      end if;
      raise exception 'The racks hold % but % were received. Every case needs a rack.', v_placed, p_quantity;
    end if;
  end if;

  -- Racks this line no longer uses become free.
  with removed as (
    delete from purchase_order_item_racks
    where purchase_order_item_id = p_item_id
      and not (warehouse_rack_id = any(v_rack_ids))
    returning warehouse_rack_id
  )
  select coalesce(array_agg(warehouse_rack_id), '{}') into v_released from removed;

  update warehouse_racks
  set is_occupied = false, updated_at = now()
  where id = any(v_released)
    and not exists (select 1 from purchase_order_item_racks r where r.warehouse_rack_id = warehouse_racks.id);

  if v_here > 0 then
    insert into purchase_order_item_racks (purchase_order_item_id, warehouse_rack_id, quantity)
    select p_item_id, (entry ->> 'rack_id')::uuid, (entry ->> 'quantity')::integer
    from jsonb_array_elements(p_racks) as entry
    on conflict (purchase_order_item_id, warehouse_rack_id) do update
      set quantity = excluded.quantity;

    update warehouse_racks
    set is_occupied = true, updated_at = now()
    where id = any(v_rack_ids);
  end if;

  -- 0 only happens as a correction. The line was already paid to reach receiving,
  -- so it returns to awaiting delivery.
  v_status := case
    when p_quantity = 0 then 'awaiting delivery'
    when p_quantity < v_item.ordered_quantity then 'partially delivered'
    else 'fully delivered'
  end;

  update purchase_order_items
  set received_quantity = p_quantity,
      received_condition = p_condition,
      warehouse_rack_id = v_rack_ids[1],
      status = v_status,
      fully_received_at = case when v_status = 'fully delivered' then now() end,
      updated_at = now()
  where id = p_item_id;

  -- The whole purchase order.
  select coalesce(sum(ordered_quantity), 0), coalesce(sum(received_quantity), 0)
  into v_ordered, v_received
  from purchase_order_items
  where purchase_order_id = v_item.purchase_order_id;

  v_po_status := case
    when v_ordered > 0 and v_received >= v_ordered then 'fully delivered'
    when v_received > 0 then 'partially delivered'
    else 'sent to supplier'
  end;

  update purchase_orders
  set status = v_po_status, updated_at = now()
  where id = v_item.purchase_order_id
  returning customer_order_id into v_order_id;

  -- Every order waiting on this line moves on, once, when all its goods are in.
  for v_candidate in
    select o.id, o.customer_id, o.order_number
    from customer_orders o
    where lower(trim(o.status)) = 'procurement'
      and (o.id = v_order_id
           or exists (select 1 from customer_order_items c where c.customer_order_id = o.id and c.po_item_id = p_item_id))
    order by o.id
    for update
  loop
    if public.order_cases_waiting(v_candidate.id) = 0 then
      update customer_orders set status = 'warehouse preparation' where id = v_candidate.id;

      insert into customer_order_status_history (customer_order_id, previous_status, new_status)
      values (v_candidate.id, 'procurement', 'warehouse preparation');

      begin
        insert into notifications (user_id, role, title, message, type, link, related_customer_order_id)
        values (
          v_candidate.customer_id,
          'customer',
          format('%s is now in warehouse preparation', v_candidate.order_number),
          format('Your order %s status is now "Warehouse Preparation". Please check your order details for more information.', v_candidate.order_number),
          'info',
          '/my-orders',
          v_candidate.id
        );
      exception when foreign_key_violation then
        null;
      end;

      if v_candidate.id = v_order_id then
        v_moved := true;
      end if;
    end if;
  end loop;

  return jsonb_build_object('item_status', v_status, 'po_status', v_po_status, 'order_moved', v_moved);
end;
$$;

revoke execute on function public.receive_purchase_order_item(uuid, integer, text, jsonb) from public, anon;
grant execute on function public.receive_purchase_order_item(uuid, integer, text, jsonb) to authenticated;


-- 15. Loading: only the cases going in this container ----------------------------------------
-- As in 022, plus: a product with no cases in this container (all waiting) isn't
-- loaded; and for an order split by a rush shipment, only the cases going in
-- this container leave their racks.
create or replace function public.load_order_items(p_customer_order_id uuid, p_item_ids uuid[] default null)
returns table (items_loaded integer, racks_freed integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status    text;
  v_items     uuid[];
  v_products  uuid[];
  v_lines     uuid[];
  v_racks     uuid[];
  v_missing   integer;
  v_freed     integer := 0;
  v_item      record;
  v_line      uuid;
begin
  if not public.has_role('admin', 'warehouse') then
    raise exception 'Only warehouse staff can mark goods as loaded.';
  end if;

  -- One at a time per order, like shipping.
  select o.status into v_status from customer_orders o where o.id = p_customer_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;

  if lower(trim(v_status)) not in ('warehouse preparation', 'ready for shipment') then
    raise exception 'Only an order in warehouse preparation or ready for shipment can be loaded.';
  end if;

  if p_item_ids is not null and exists (
    select 1 from unnest(p_item_ids) as asked(id)
    where not exists (select 1 from customer_order_items i where i.id = asked.id and i.customer_order_id = p_customer_order_id)
  ) then
    raise exception 'That product isn''t part of this order.';
  end if;

  -- The products to load: those asked for (else all of the order's), not loaded
  -- yet, with cases going in this container.
  select coalesce(array_agg(i.id), '{}'), coalesce(array_agg(distinct i.product_id), '{}')
    into v_items, v_products
  from customer_order_items i
  where i.customer_order_id = p_customer_order_id
    and (p_item_ids is null or i.id = any(p_item_ids))
    and i.loaded_at is null
    and coalesce(i.ship_quantity, i.quantity) > 0;

  -- Only goods with their labels applied go into the container.
  select count(*) into v_missing
  from unnest(v_items) as item(id)
  where not exists (
    select 1 from compliance_label_exchanges e
    where e.customer_order_item_id = item.id and lower(trim(e.status)) = 'applied to units'
  );

  if v_missing > 0 then
    raise exception 'Apply the labels before loading: % of these products still need them.', v_missing;
  end if;

  update customer_order_items set loaded_at = now() where id = any(v_items);

  if public.order_is_split(p_customer_order_id) then
    -- Case by case: only what goes in this container leaves its racks.
    for v_item in
      select i.id, coalesce(i.ship_quantity, i.quantity) as cases
      from customer_order_items i
      where i.id = any(v_items)
    loop
      select x.po_item_id into v_line from public.order_item_line(v_item.id) x;
      v_freed := v_freed + public.release_line_cases(v_line, v_item.cases);
    end loop;

    return query select coalesce(array_length(v_items, 1), 0), v_freed;
    return;
  end if;

  -- Those products' PO lines in this order, and the racks holding their goods.
  select coalesce(array_agg(l.id), '{}') into v_lines
  from purchase_order_items l
  join purchase_orders p on p.id = l.purchase_order_id
  where p.customer_order_id = p_customer_order_id
    and l.product_id = any(v_products);

  with removed as (
    delete from purchase_order_item_racks
    where purchase_order_item_id = any(v_lines)
    returning warehouse_rack_id
  )
  select coalesce(array_agg(warehouse_rack_id), '{}') into v_racks from removed;

  v_racks := v_racks || coalesce((
    select array_agg(l.warehouse_rack_id) from purchase_order_items l
    where l.id = any(v_lines) and l.warehouse_rack_id is not null
  ), '{}');

  update purchase_order_items
  set warehouse_rack_id = null, updated_at = now()
  where id = any(v_lines) and warehouse_rack_id is not null;

  -- Each of those racks is free again, unless other goods are still in it.
  update warehouse_racks w
  set is_occupied = false, updated_at = now()
  where w.id = any(v_racks)
    and w.is_occupied
    and not exists (select 1 from purchase_order_item_racks r where r.warehouse_rack_id = w.id)
    and not exists (select 1 from purchase_order_items l where l.warehouse_rack_id = w.id);
  get diagnostics v_freed = row_count;

  return query select coalesce(array_length(v_items, 1), 0), v_freed;
end;
$$;

revoke execute on function public.load_order_items(uuid, uuid[]) from public, anon;
grant execute on function public.load_order_items(uuid, uuid[]) to authenticated;


-- 16. Shipping: "partly shipped" when goods wait; the earlier order finishes later ----------
-- A line's waiting cases have all left: they went with a later order's
-- container (that order shipped, in full or in part) and none of them were
-- left waiting again there (or those, in turn, left later).
create or replace function public.item_waiting_gone(p_item_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_item    customer_order_items;
  v_next    customer_order_items;
  v_status  text;
begin
  select * into v_item from customer_order_items where id = p_item_id;

  if v_item.id is null or v_item.ship_quantity is null or v_item.ship_quantity >= v_item.quantity then
    return true;
  end if;

  select c.* into v_next from customer_order_items c where c.carried_from_item_id = p_item_id;
  if v_next.id is null then
    return false;
  end if;

  select lower(trim(status)) into v_status from customer_orders where id = v_next.customer_order_id;
  if coalesce(v_status, '') not in ('shipped', 'partly shipped') then
    return false;
  end if;

  return public.item_waiting_gone(v_next.id);
end;
$$;

revoke execute on function public.item_waiting_gone(uuid) from public, anon, authenticated;

-- When an order ships, any earlier order whose waiting goods have now all left
-- (with this order, or later ones) becomes "shipped" too.
create or replace function public.settle_waiting_orders(p_customer_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source uuid;
begin
  for v_source in
    select distinct s.customer_order_id
    from customer_order_items c
    join customer_order_items s on s.id = c.carried_from_item_id
    where c.customer_order_id = p_customer_order_id
  loop
    if exists (select 1 from customer_orders o where o.id = v_source and lower(trim(o.status)) = 'partly shipped')
       and not exists (
         select 1
         from customer_order_items s
         where s.customer_order_id = v_source
           and not public.item_waiting_gone(s.id)
       ) then
      update customer_orders set status = 'shipped' where id = v_source;

      insert into customer_order_status_history (customer_order_id, previous_status, new_status, changed_at)
      values (v_source, 'partly shipped', 'shipped', now());

      perform public.settle_waiting_orders(v_source);
    end if;
  end loop;
end;
$$;

revoke execute on function public.settle_waiting_orders(uuid) from public, anon, authenticated;

-- As in 021, plus: only the cases going in this container need their labels and
-- leave their racks; with goods still waiting, the order is "partly shipped".
create or replace function public.ship_customer_order(p_customer_order_id uuid, p_check_only boolean default false)
returns table (customer_id uuid, order_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    customer_orders%rowtype;
  v_items    integer;
  v_applied  integer;
  v_item     record;
  v_line     uuid;
  v_status   text;
begin
  if not public.has_role('admin', 'warehouse') then
    raise exception 'Only warehouse staff can mark an order as shipped.';
  end if;

  -- One at a time: a second click waits here, then finds it shipped.
  select * into v_order from customer_orders o where o.id = p_customer_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;

  if lower(trim(v_order.status)) = 'shipped' then
    raise exception 'This order is already marked as shipped.';
  end if;

  if lower(trim(v_order.status)) = 'partly shipped' then
    raise exception 'This order''s container already left. Its waiting goods go with the customer''s next order.';
  end if;

  if lower(trim(v_order.status)) not in ('warehouse preparation', 'ready for shipment') then
    raise exception 'Only an order in warehouse preparation or ready for shipment can be shipped.';
  end if;

  -- Every item going in this container has its labels applied, as of now.
  select count(*),
         count(*) filter (where exists (
           select 1 from compliance_label_exchanges e
           where e.customer_order_item_id = i.id and lower(trim(e.status)) = 'applied to units'
         ))
    into v_items, v_applied
  from customer_order_items i
  where i.customer_order_id = p_customer_order_id
    and coalesce(i.ship_quantity, i.quantity) > 0;

  if v_items = 0 or v_applied < v_items then
    raise exception 'Labels are applied on % of % items. Every item needs its labels applied before shipping.', v_applied, v_items;
  end if;

  if not p_check_only then
    if public.order_is_split(p_customer_order_id) then
      for v_item in
        select i.id, coalesce(i.ship_quantity, i.quantity) as cases
        from customer_order_items i
        where i.customer_order_id = p_customer_order_id
          and i.loaded_at is null
          and coalesce(i.ship_quantity, i.quantity) > 0
      loop
        select x.po_item_id into v_line from public.order_item_line(v_item.id) x;
        perform public.release_line_cases(v_line, v_item.cases);
      end loop;

      update customer_order_items
      set loaded_at = now()
      where customer_order_id = p_customer_order_id
        and loaded_at is null
        and coalesce(ship_quantity, quantity) > 0;
    else
      perform public.release_order_racks(p_customer_order_id);
    end if;

    v_status := case
      when exists (
        select 1 from customer_order_items i
        where i.customer_order_id = p_customer_order_id
          and i.ship_quantity is not null
          and i.ship_quantity < i.quantity
      ) then 'partly shipped'
      else 'shipped'
    end;

    update customer_orders
    set status = v_status,
        estimated_ship_date = (now() at time zone 'Asia/Manila')::date
    where id = p_customer_order_id;

    insert into customer_order_status_history (customer_order_id, previous_status, new_status, changed_at)
    values (p_customer_order_id, v_order.status, v_status, now());

    -- Earlier orders whose waiting goods have now all left finish too.
    perform public.settle_waiting_orders(p_customer_order_id);
  end if;

  return query select v_order.customer_id, v_order.order_number;
end;
$$;

revoke execute on function public.ship_customer_order(uuid, boolean) from public, anon;
grant execute on function public.ship_customer_order(uuid, boolean) to authenticated;


-- 17. A cancelled order lets go of the waiting goods -------------------------------------
-- The goods waiting from an earlier order were only to travel in this order's
-- container. If it's cancelled before it ships, they wait again, and the
-- customer's next quotation must take them (approving it checks that).
create or replace function public.release_waiting_goods_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(lower(trim(new.status)), '') = 'cancelled'
     and coalesce(lower(trim(old.status)), '') <> 'cancelled' then
    delete from customer_order_items
    where customer_order_id = new.id
      and carried_from_item_id is not null;
  end if;

  return new;
end;
$$;

revoke execute on function public.release_waiting_goods_on_cancel() from public, anon, authenticated;

drop trigger if exists customer_orders_release_waiting_goods on public.customer_orders;
create trigger customer_orders_release_waiting_goods
  after update of status on public.customer_orders
  for each row execute function public.release_waiting_goods_on_cancel();


-- 18. A partly shipped order's container arrives -------------------------------------------
-- As in 025, plus: a partly shipped order's arrival can be recorded, and the
-- days at sea count from the day its own container left (it becoming "shipped"
-- later is its waiting goods leaving with the next order).
create or replace function public.record_order_arrival(p_customer_order_id uuid, p_arrived_on date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order       customer_orders%rowtype;
  v_shipped_on  date;
  v_today       date := (now() at time zone 'Asia/Manila')::date;
begin
  if not public.has_role('admin', 'sales', 'warehouse') then
    raise exception 'Only sales, warehouse or admin can record an arrival.';
  end if;

  select * into v_order from customer_orders where id = p_customer_order_id for update;

  if not found then
    raise exception 'This order no longer exists.';
  end if;

  if lower(trim(v_order.status)) not in ('shipped', 'partly shipped') then
    raise exception 'Only a shipped order can arrive. % is %.', v_order.order_number, v_order.status;
  end if;

  if p_arrived_on is null then
    raise exception 'Enter the day the container arrived.';
  end if;

  if p_arrived_on > v_today then
    raise exception 'The arrival day can''t be in the future.';
  end if;

  -- The day its own container left, in the Philippines.
  select (max(changed_at) at time zone 'Asia/Manila')::date into v_shipped_on
  from customer_order_status_history
  where customer_order_id = p_customer_order_id
    and lower(trim(new_status)) in ('shipped', 'partly shipped')
    and coalesce(lower(trim(previous_status)), '') <> 'partly shipped';

  if v_shipped_on is not null and p_arrived_on < v_shipped_on then
    raise exception 'The container can''t arrive before it shipped on %.', to_char(v_shipped_on, 'Mon FMDD, YYYY');
  end if;

  update customer_orders
  set arrived_on = p_arrived_on,
      arrival_recorded_at = now(),
      arrival_recorded_by = auth.uid()
  where id = p_customer_order_id;

  return jsonb_build_object(
    'order_number', v_order.order_number,
    'arrived_on', p_arrived_on,
    'days_at_sea', case when v_shipped_on is null then null else p_arrived_on - v_shipped_on end
  );
end;
$$;

revoke execute on function public.record_order_arrival(uuid, date) from public, anon;
grant execute on function public.record_order_arrival(uuid, date) to authenticated;


-- Check: everything is in place (expect true in every column) ----------------------------
select
  to_regprocedure('public.agree_rush_shipment(uuid, text)') is not null
    and to_regprocedure('public.rush_shipment_preview(uuid)') is not null
    and to_regprocedure('public.my_rush_options()') is not null
    and to_regprocedure('public.waiting_goods(uuid)') is not null as rush_shipment_steps,
  to_regclass('public.order_rush_agreements') is not null as agreements_recorded,
  exists (select 1 from pg_trigger where tgname = 'customer_order_items_rush_details') as rush_details_protected,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_order_items' and column_name = 'cases_loaded'
  ) as racks_freed_case_by_case;
