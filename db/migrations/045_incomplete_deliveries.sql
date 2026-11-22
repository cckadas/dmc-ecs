-- =============================================================================
-- 045: Incomplete supplier deliveries
--
-- DMC's rule (2026-11-22). At Receiving the warehouse compares what arrived
-- with the purchase order line:
--   - all of it: Fully Delivered;
--   - not all of it: Incomplete Delivery, typing the cases delivered AND the
--     cases missing, which must add up to the line (so a typing mistake shows),
--     and saying whether the rest is still coming or won't come.
-- Cases that won't come were already paid to the supplier:
--   - the supplier owes them (supplier_owed_cases, "Owed by suppliers" on
--     Purchase Orders): they count toward DMC's next purchase order of that
--     product from that supplier (046), or procurement marks them refunded;
--   - the customer doesn't pay for them: their value, at the customer's own
--     price, comes off the order's total, so the remaining 50% is that much
--     less. If the customer has already paid more than the new total, DMC
--     owes the difference back; sales records the refund when it's sent.
--   - the order goes on without them (to warehouse preparation once nothing
--     else is still coming), and the customer is told.
-- A line closed with missing cases stays closed. An order with a rush shipment
-- can't have missing cases recorded yet (its waiting goods depend on them).
-- Safe to run more than once. The last query shows true, true, true, true.
-- =============================================================================


-- 1. What didn't come, and what's owed back ------------------------------------------------------
alter table public.purchase_order_items add column if not exists missing_quantity integer not null default 0;
alter table public.purchase_order_items add column if not exists missing_recorded_at timestamptz;
alter table public.purchase_order_items add column if not exists missing_recorded_by_name text;
alter table public.purchase_order_items drop constraint if exists purchase_order_items_missing_not_negative;
alter table public.purchase_order_items add constraint purchase_order_items_missing_not_negative check (missing_quantity >= 0);

alter table public.customer_orders add column if not exists missing_goods_amount numeric not null default 0;
alter table public.customer_orders add column if not exists refunded_amount numeric not null default 0;
alter table public.customer_orders add column if not exists refunded_at timestamptz;
alter table public.customer_orders add column if not exists refund_bank text;
alter table public.customer_orders add column if not exists refund_reference text;
alter table public.customer_orders add column if not exists refunded_by_name text;

create table if not exists public.supplier_owed_cases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers (id),
  product_id uuid references public.products (id),
  cases integer not null check (cases > 0),
  unit_price numeric not null default 0,
  from_po_item_id uuid not null unique references public.purchase_order_items (id) on delete cascade,
  customer_order_id uuid references public.customer_orders (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by_name text,
  used_cases integer not null default 0 check (used_cases >= 0),
  refunded_at timestamptz,
  refunded_by_name text
);

alter table public.supplier_owed_cases enable row level security;
revoke all on public.supplier_owed_cases from anon, authenticated;
grant select on public.supplier_owed_cases to authenticated;
drop policy if exists "staff: read owed cases" on public.supplier_owed_cases;
create policy "staff: read owed cases" on public.supplier_owed_cases
  for select to authenticated
  using ((select public.has_role('admin', 'procurement', 'sales', 'management', 'warehouse')));


-- 2. An order's amounts: also changed when missing goods come off it --------------------------
-- As in 034, plus: the missing-goods step may change the total; and only
-- sales or admin change what came off or what was refunded.
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

  -- Missing goods taken off through receive_purchase_order_item (045): only
  -- the total and what came off change.
  if coalesce(current_setting('dmc.missing_goods', true), '') = 'on'
     and (to_jsonb(new) - array['total_amount', 'missing_goods_amount', 'updated_at'])
       = (to_jsonb(old) - array['total_amount', 'missing_goods_amount', 'updated_at']) then
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
    or new.missing_goods_amount is distinct from old.missing_goods_amount
    or new.refunded_amount is distinct from old.refunded_amount
  ) then
    raise exception 'Only sales or admin can confirm payments or change an order''s amounts.';
  end if;

  return new;
end;
$$;


-- 3. An order waits only for cases still coming ------------------------------------------------
-- As in 034, less the cases recorded as missing (they won't come).
create or replace function public.order_cases_waiting(p_customer_order_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(greatest(
           i.quantity - public.item_cases_in(i.id)
           - case when i.carried_from_item_id is null then coalesce(l.missing_quantity, 0) else 0 end,
         0)), 0)::integer
  from customer_order_items i
  cross join lateral public.order_item_line(i.id) x
  left join purchase_order_items l on l.id = x.po_item_id
  where i.customer_order_id = p_customer_order_id
$$;

revoke execute on function public.order_cases_waiting(uuid) from public, anon, authenticated;


-- 4. Missing goods come off the order ----------------------------------------------------------
-- What the order's missing cases are worth at the customer's own prices comes
-- off its total (once: worked out again from all its lines each time), and the
-- customer is told; sales too when DMC now owes a refund.
create or replace function public.take_missing_goods_off(p_customer_order_id uuid, p_lines text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    customer_orders%rowtype;
  v_missing  numeric;
  v_total    numeric;
  v_due      numeric;
  c_money    constant text := 'FM999,999,999,990.00';
begin
  select * into v_order from customer_orders where id = p_customer_order_id for update;
  if v_order.id is null then
    return;
  end if;

  select coalesce(sum(l.missing_quantity * coalesce((
           select i.unit_price from customer_order_items i
           where i.customer_order_id = v_order.id
             and i.product_id = l.product_id
             and i.carried_from_item_id is null
           order by i.id
           limit 1), 0)), 0)
  into v_missing
  from purchase_order_items l
  join purchase_orders p on p.id = l.purchase_order_id
  where p.customer_order_id = v_order.id;

  v_missing := round(v_missing, 2);
  if v_missing = coalesce(v_order.missing_goods_amount, 0) then
    return;
  end if;

  v_total := round(coalesce(v_order.total_amount, 0) + coalesce(v_order.missing_goods_amount, 0) - v_missing, 2);
  v_due := round(greatest(coalesce(v_order.settled_amount, 0) - coalesce(v_order.refunded_amount, 0) - v_total, 0), 2);

  perform set_config('dmc.missing_goods', 'on', true);
  update customer_orders
  set total_amount = v_total,
      missing_goods_amount = v_missing
  where id = v_order.id;
  perform set_config('dmc.missing_goods', 'off', true);

  begin
    insert into notifications (user_id, role, title, message, type, link, related_customer_order_id)
    values (
      v_order.customer_id, 'customer',
      format('%s - Some goods didn''t arrive', v_order.order_number),
      format('%s didn''t arrive from the supplier and won''t come. %s goes ahead without them, and ₱%s comes off it: its new total is ₱%s.%s',
        p_lines, v_order.order_number, to_char(v_missing - coalesce(v_order.missing_goods_amount, 0), c_money), to_char(v_total, c_money),
        case
          when v_due > 0 then format(' You have paid ₱%s, so DMC refunds you ₱%s.', to_char(coalesce(v_order.settled_amount, 0) - coalesce(v_order.refunded_amount, 0), c_money), to_char(v_due, c_money))
          else format(' Your remaining balance is ₱%s.', to_char(greatest(v_total - coalesce(v_order.settled_amount, 0), 0), c_money))
        end),
      'warning', '/my-orders', v_order.id
    );

    insert into notifications (user_id, role, title, message, type, link, related_customer_order_id)
    values (
      v_order.customer_id, 'sales',
      case when v_due > 0
        then format('%s - Refund due: ₱%s', v_order.order_number, to_char(v_due, c_money))
        else format('%s - Missing goods taken off', v_order.order_number)
      end,
      format('%s won''t come for %s, so ₱%s came off it (new total ₱%s).%s',
        p_lines, v_order.order_number, to_char(v_missing - coalesce(v_order.missing_goods_amount, 0), c_money), to_char(v_total, c_money),
        case when v_due > 0 then format(' The customer has paid more than that: refund ₱%s and record it on Customer Orders.', to_char(v_due, c_money)) else '' end),
      case when v_due > 0 then 'warning' else 'info' end, '/customer-orders', v_order.id
    );
  exception when foreign_key_violation then
    null;
  end;
end;
$$;

revoke execute on function public.take_missing_goods_off(uuid, text) from public, anon, authenticated;


-- 5. Receiving: fully delivered, or incomplete with the rest coming or not -------------------
-- As in 043, plus p_missing: the cases that won't come. With them, received +
-- missing must be the whole line, which then closes.
drop function if exists public.receive_purchase_order_item(uuid, integer, text, jsonb);

create or replace function public.receive_purchase_order_item(
  p_item_id    uuid,
  p_quantity   integer,
  p_condition  text,
  p_racks      jsonb default '[]'::jsonb,
  p_missing    integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item        purchase_order_items%rowtype;
  v_rack        warehouse_racks%rowtype;
  v_cbm         numeric;
  v_unit        text;
  v_product     text;
  v_line_order  uuid;
  v_other       text;
  v_used        numeric;
  v_entry       jsonb;
  v_share       integer;
  v_placed      integer := 0;
  v_here        integer;
  v_missing     integer := coalesce(p_missing, 0);
  v_name        text;
  v_po_number   text;
  v_supplier    text;
  v_rack_ids    uuid[] := '{}';
  v_released    uuid[];
  v_status      text;
  v_ordered     integer;
  v_received    integer;
  v_missing_po  integer;
  v_po_status   text;
  v_order_id    uuid;
  v_candidate   record;
  v_moved       boolean := false;
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

  if v_missing < 0 then
    raise exception 'The cases missing can''t be below 0.';
  end if;

  -- A line closed with missing cases stays closed.
  if coalesce(v_item.missing_quantity, 0) > 0 then
    raise exception 'This line was closed with % cases missing. It can''t be received again.', v_item.missing_quantity;
  end if;

  if p_quantity = 0 and v_missing = 0 and coalesce(v_item.received_quantity, 0) = 0 then
    raise exception 'Please enter the quantity received.';
  end if;

  if p_quantity > v_item.ordered_quantity then
    raise exception 'Received quantity cannot exceed ordered quantity.';
  end if;

  -- Received and missing together must be the whole line: a typing mistake shows.
  if v_missing > 0 and p_quantity + v_missing <> v_item.ordered_quantity then
    raise exception 'These don''t add up: % received + % missing = %, but this line is for % cases. Check the count.',
      p_quantity, v_missing, p_quantity + v_missing, v_item.ordered_quantity;
  end if;

  select customer_order_id, po_number into v_line_order, v_po_number from purchase_orders where id = v_item.purchase_order_id;

  if v_missing > 0 and exists (select 1 from order_rush_agreements a where a.customer_order_id = v_line_order) then
    raise exception 'A rush shipment was agreed for this order, so its missing goods can''t be recorded yet. Record the rest as still coming for now.';
  end if;

  -- Cases of this line already loaded into a container left the warehouse.
  if p_quantity < coalesce(v_item.cases_loaded, 0) then
    raise exception '% cases of this line have already left in a container, so the received total can''t be less than that.', v_item.cases_loaded;
  end if;

  v_here := p_quantity - coalesce(v_item.cases_loaded, 0);

  select cbm, coalesce(unit, 'unit'), product_name into v_cbm, v_unit, v_product from products where id = v_item.product_id;

  if v_here > 0 then
    if coalesce(v_cbm, 0) <= 0 then
      raise exception '% has no volume per case yet, so the space it takes can''t be counted. Enter its volume per case on Products first (warehouse staff can).', coalesce(v_product, 'This product');
    end if;

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
        raise exception 'One of the chosen slots no longer exists.';
      end if;

      if v_share is null or v_share <= 0 then
        raise exception 'Enter how many go in slot %.', coalesce(v_rack.name, v_rack.rack_id);
      end if;

      if v_rack.id = any(v_rack_ids) then
        raise exception 'Slot % is chosen twice.', coalesce(v_rack.name, v_rack.rack_id);
      end if;

      -- A slot this line already sits in stays allowed, even if inactive.
      if not v_rack.is_active and not exists (
        select 1 from purchase_order_item_racks
        where purchase_order_item_id = p_item_id and warehouse_rack_id = v_rack.id
      ) then
        raise exception 'Slot % is inactive and cannot be used.', coalesce(v_rack.name, v_rack.rack_id);
      end if;

      -- Another order's goods in it: no.
      select string_agg(distinct coalesce(o.order_number, 'another order'), ', ') into v_other
      from purchase_order_item_racks r
      join purchase_order_items i on i.id = r.purchase_order_item_id
      join purchase_orders p on p.id = i.purchase_order_id
      left join customer_orders o on o.id = p.customer_order_id
      where r.warehouse_rack_id = v_rack.id
        and r.purchase_order_item_id <> p_item_id
        and p.customer_order_id is distinct from v_line_order;

      if v_other is not null then
        raise exception 'Slot % holds goods of %. A slot holds one order''s goods only.', coalesce(v_rack.name, v_rack.rack_id), v_other;
      end if;

      -- What else is in it (this order's other products) leaves this much room.
      select coalesce(sum(r.quantity * coalesce(pr.cbm, 0)), 0) into v_used
      from purchase_order_item_racks r
      join purchase_order_items i on i.id = r.purchase_order_item_id
      left join products pr on pr.id = i.product_id
      where r.warehouse_rack_id = v_rack.id
        and r.purchase_order_item_id <> p_item_id;

      if v_share * v_cbm > v_rack.capacity_cbm - v_used + 0.000001 then
        raise exception 'Slot % has room for % more % of this product (% m³ free of %).',
          coalesce(v_rack.name, v_rack.rack_id),
          greatest(floor((v_rack.capacity_cbm - v_used + 0.000001) / v_cbm), 0),
          v_unit,
          round(greatest(v_rack.capacity_cbm - v_used, 0), 2),
          v_rack.capacity_cbm;
      end if;

      v_placed := v_placed + v_share;
      v_rack_ids := v_rack_ids || v_rack.id;
    end loop;

    if v_placed <> v_here then
      if coalesce(v_item.cases_loaded, 0) > 0 then
        raise exception 'The slots hold % but % are in the warehouse (% received, % already left in a container). Every case in the warehouse needs a slot.',
          v_placed, v_here, p_quantity, v_item.cases_loaded;
      end if;
      raise exception 'The slots hold % but % were received. Every case needs a slot.', v_placed, p_quantity;
    end if;
  end if;

  -- Slots this line no longer uses: free again, unless other goods are in them.
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

  -- 0 with nothing missing only happens as a correction: the line returns to
  -- awaiting delivery. With missing cases it closes, short.
  v_status := case
    when v_missing > 0 then 'delivered short'
    when p_quantity = 0 then 'awaiting delivery'
    when p_quantity < v_item.ordered_quantity then 'partially delivered'
    else 'fully delivered'
  end;

  select name into v_name from profiles where id = auth.uid();

  update purchase_order_items
  set received_quantity = p_quantity,
      received_condition = p_condition,
      warehouse_rack_id = v_rack_ids[1],
      status = v_status,
      missing_quantity = v_missing,
      missing_recorded_at = case when v_missing > 0 then now() end,
      missing_recorded_by_name = case when v_missing > 0 then v_name end,
      fully_received_at = case when v_status in ('fully delivered', 'delivered short') then now() end,
      updated_at = now()
  where id = p_item_id;

  -- Cases that won't come: the supplier owes them, and the customer doesn't pay for them.
  if v_missing > 0 then
    insert into supplier_owed_cases (supplier_id, product_id, cases, unit_price, from_po_item_id, customer_order_id, created_by_name)
    values (v_item.supplier_id, v_item.product_id, v_missing, coalesce(v_item.unit_price, 0), p_item_id, v_line_order, v_name)
    on conflict (from_po_item_id) do nothing;

    select supplier_name into v_supplier from suppliers where id = v_item.supplier_id;

    begin
      insert into notifications (user_id, role, title, message, type, link)
      select o.customer_id, 'procurement',
        format('%s - %s owes %s %s', coalesce(v_po_number, 'A purchase order'), coalesce(v_supplier, 'A supplier'), v_missing, v_unit),
        format('%s didn''t deliver %s %s of %s on %s, already paid for. They''re listed under Owed by suppliers and count toward DMC''s next purchase order of that product from them.',
          coalesce(v_supplier, 'The supplier'), v_missing, v_unit, coalesce(v_product, 'a product'), coalesce(v_po_number, 'its purchase order')),
        'warning', '/purchase-orders'
      from customer_orders o
      where o.id = v_line_order;
    exception when foreign_key_violation then
      null;
    end;

    perform public.take_missing_goods_off(v_line_order, format('%s (%s %s)', coalesce(v_product, 'A product'), v_missing, v_unit));
  end if;

  -- The whole purchase order: done once nothing is still coming.
  select coalesce(sum(ordered_quantity), 0), coalesce(sum(received_quantity), 0), coalesce(sum(missing_quantity), 0)
  into v_ordered, v_received, v_missing_po
  from purchase_order_items
  where purchase_order_id = v_item.purchase_order_id;

  v_po_status := case
    when v_ordered > 0 and v_received + v_missing_po >= v_ordered and v_missing_po > 0 then 'delivered short'
    when v_ordered > 0 and v_received >= v_ordered then 'fully delivered'
    when v_received > 0 or v_missing_po > 0 then 'partially delivered'
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

revoke execute on function public.receive_purchase_order_item(uuid, integer, text, jsonb, integer) from public, anon;
grant execute on function public.receive_purchase_order_item(uuid, integer, text, jsonb, integer) to authenticated;


-- 6. Recording a refund sent to the customer ----------------------------------------------------
create or replace function public.record_order_refund(p_customer_order_id uuid, p_amount numeric, p_bank text, p_reference text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  customer_orders%rowtype;
  v_due    numeric;
  v_name   text;
  c_money  constant text := 'FM999,999,999,990.00';
begin
  if not public.has_role('admin', 'sales') then
    raise exception 'Only sales or admin can record a refund.';
  end if;

  select * into v_order from customer_orders where id = p_customer_order_id for update;
  if v_order.id is null then
    raise exception 'Order not found.';
  end if;

  v_due := round(greatest(coalesce(v_order.settled_amount, 0) - coalesce(v_order.refunded_amount, 0) - coalesce(v_order.total_amount, 0), 0), 2);

  if v_due <= 0 then
    raise exception 'Nothing is owed back on %.', v_order.order_number;
  end if;

  if p_amount is null or round(p_amount, 2) <> v_due then
    raise exception 'DMC owes ₱% back on %: record exactly that.', to_char(v_due, c_money), v_order.order_number;
  end if;

  if nullif(trim(coalesce(p_bank, '')), '') is null then
    raise exception 'Enter the bank the refund was sent through.';
  end if;

  select name into v_name from profiles where id = auth.uid();

  update customer_orders
  set refunded_amount = coalesce(refunded_amount, 0) + v_due,
      refunded_at = now(),
      refund_bank = trim(p_bank),
      refund_reference = nullif(trim(coalesce(p_reference, '')), ''),
      refunded_by_name = v_name
  where id = v_order.id;

  begin
    insert into notifications (user_id, role, title, message, type, link, related_customer_order_id)
    values (
      v_order.customer_id, 'customer',
      format('%s - Refund sent: ₱%s', v_order.order_number, to_char(v_due, c_money)),
      format('DMC sent your refund of ₱%s for %s through %s%s.', to_char(v_due, c_money), v_order.order_number, trim(p_bank),
        coalesce(format(' (reference %s)', nullif(trim(coalesce(p_reference, '')), '')), '')),
      'info', '/my-orders', v_order.id
    );
  exception when foreign_key_violation then
    null;
  end;

  return jsonb_build_object('order', v_order.order_number, 'refunded', v_due);
end;
$$;

revoke execute on function public.record_order_refund(uuid, numeric, text, text) from public, anon;
grant execute on function public.record_order_refund(uuid, numeric, text, text) to authenticated;


-- 7. Owed cases the supplier refunded instead ----------------------------------------------------
create or replace function public.mark_owed_cases_refunded(p_owed_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owed  supplier_owed_cases%rowtype;
begin
  if not public.has_role('admin', 'procurement') then
    raise exception 'Only procurement or admin can close owed cases.';
  end if;

  select * into v_owed from supplier_owed_cases where id = p_owed_id for update;
  if v_owed.id is null then
    raise exception 'These owed cases no longer exist.';
  end if;
  if v_owed.refunded_at is not null then
    raise exception 'These owed cases were already marked refunded.';
  end if;
  if v_owed.used_cases >= v_owed.cases then
    raise exception 'These owed cases were all used on a later purchase order.';
  end if;

  update supplier_owed_cases
  set refunded_at = now(),
      refunded_by_name = (select name from profiles where id = auth.uid())
  where id = p_owed_id;
end;
$$;

revoke execute on function public.mark_owed_cases_refunded(uuid) from public, anon;
grant execute on function public.mark_owed_cases_refunded(uuid) to authenticated;


-- Check: true, true, true, true.
select
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'purchase_order_items' and column_name = 'missing_quantity') as missing_recorded,
  to_regclass('public.supplier_owed_cases') is not null as owed_by_suppliers,
  to_regprocedure('public.record_order_refund(uuid, numeric, text, text)') is not null as refunds_recorded,
  to_regprocedure('public.receive_purchase_order_item(uuid, integer, text, jsonb, integer)') is not null
    and to_regprocedure('public.receive_purchase_order_item(uuid, integer, text, jsonb)') is null as receiving_with_missing;
