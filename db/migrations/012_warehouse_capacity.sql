-- =============================================================================
-- 012 — Rack capacity, deliveries across several racks, and a full warehouse
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm). Safe to re-run.
-- All or nothing: if any line fails, nothing is changed. Run 011 first.
--
-- The panel's exceptional cases:
--   - An order needing several racks: one delivery line can now be split across
--     racks, as long as each rack's share fits its capacity.
--   - A full warehouse: a delivery that doesn't fit can't be recorded into racks
--     that aren't there. The screens warn early and say what fits.
--   - Several orders at once: racks are locked while a delivery is recorded, so
--     two people can't put goods in the same rack at the same moment.
--
-- A rack still holds one delivery line at a time (BR-28). Its capacity is a volume
-- in m³, compared with each case's volume from products.cbm. New columns default
-- to 10 m³ as a placeholder until DMC gives each rack's real capacity.
-- =============================================================================

begin;


-- Rack capacity ---------------------------------------------------------------
alter table public.warehouse_racks
  add column if not exists capacity_cbm numeric not null default 10;

alter table public.warehouse_racks
  drop constraint if exists warehouse_racks_capacity_positive;

alter table public.warehouse_racks
  add constraint warehouse_racks_capacity_positive check (capacity_cbm > 0);


-- Which racks hold which delivery line, and how many of it --------------------
-- Its own id, not the two columns, as the primary key: otherwise the website's API
-- sees a second route between PO lines and racks, and existing queries that join
-- the two stop working.
create table if not exists public.purchase_order_item_racks (
  id                      uuid    primary key default gen_random_uuid(),
  purchase_order_item_id  uuid    not null references public.purchase_order_items(id) on delete cascade,
  warehouse_rack_id       uuid    not null references public.warehouse_racks(id),
  quantity                integer not null check (quantity > 0),
  created_at              timestamptz not null default now(),
  unique (purchase_order_item_id, warehouse_rack_id)
);

-- Who can read it comes in 013. Only the functions below write to it.
alter table public.purchase_order_item_racks enable row level security;

-- Goods already sitting in a rack move to the new table as they are.
insert into public.purchase_order_item_racks (purchase_order_item_id, warehouse_rack_id, quantity)
select id, warehouse_rack_id, greatest(received_quantity, 1)
from public.purchase_order_items
where warehouse_rack_id is not null
on conflict (purchase_order_item_id, warehouse_rack_id) do nothing;


-- When a delivery line was fully received -------------------------------------
-- For supplier lead times and on-time rates, which until now had no real date.
alter table public.purchase_order_items
  add column if not exists fully_received_at timestamptz;


-- A rack holding goods can't be marked free -----------------------------------
create or replace function public.protect_occupied_racks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_occupied = false
     and exists (select 1 from purchase_order_item_racks where warehouse_rack_id = new.id) then
    raise exception 'Rack % still holds delivered goods, so it can''t be marked available.', coalesce(new.name, new.rack_id);
  end if;

  return new;
end;
$$;

drop trigger if exists warehouse_racks_protect_occupied on public.warehouse_racks;
create trigger warehouse_racks_protect_occupied
  before update of is_occupied on public.warehouse_racks
  for each row execute function public.protect_occupied_racks();


-- Record a delivery -----------------------------------------------------------
-- p_quantity is the total received so far for this line; 0 undoes a wrong receipt.
-- p_racks lists where it all sits: [{"rack_id": "...", "quantity": 20}, ...].
-- Everything happens or nothing does, including moving the order on to warehouse
-- preparation and telling the customer once the whole PO has arrived.
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
  v_rack_ids   uuid[] := '{}';
  v_released   uuid[];
  v_status     text;
  v_ordered    integer;
  v_received   integer;
  v_po_status  text;
  v_order_id   uuid;
  v_customer   uuid;
  v_order_no   text;
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

  select cbm, coalesce(unit, 'unit') into v_cbm, v_unit from products where id = v_item.product_id;

  if p_quantity > 0 then
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

    if v_placed <> p_quantity then
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
  where id = any(v_released);

  if p_quantity > 0 then
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

  -- Everything has arrived: the order moves on, once.
  if v_po_status = 'fully delivered' then
    update customer_orders
    set status = 'warehouse preparation'
    where id = v_order_id
      and lower(trim(status)) = 'procurement'
    returning customer_id, order_number into v_customer, v_order_no;

    if found then
      v_moved := true;

      insert into customer_order_status_history (customer_order_id, previous_status, new_status)
      values (v_order_id, 'procurement', 'warehouse preparation');

      insert into notifications (user_id, role, title, message, type, link, related_customer_order_id)
      values (
        v_customer,
        'customer',
        format('%s is now in warehouse preparation', v_order_no),
        format('Your order %s status is now "Warehouse Preparation". Please check your order details for more information.', v_order_no),
        'info',
        '/my-orders',
        v_order_id
      );
    end if;
  end if;

  return jsonb_build_object('item_status', v_status, 'po_status', v_po_status, 'order_moved', v_moved);
end;
$$;

revoke execute on function public.receive_purchase_order_item(uuid, integer, text, jsonb) from public, anon;
grant execute on function public.receive_purchase_order_item(uuid, integer, text, jsonb) to authenticated;


-- Free an order's racks when it ships -----------------------------------------
create or replace function public.release_order_racks(p_customer_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items  uuid[];
  v_racks  uuid[];
begin
  if not public.has_role('admin', 'warehouse') then
    raise exception 'Only warehouse staff can free racks.';
  end if;

  select coalesce(array_agg(i.id), '{}') into v_items
  from purchase_order_items i
  join purchase_orders p on p.id = i.purchase_order_id
  where p.customer_order_id = p_customer_order_id;

  with removed as (
    delete from purchase_order_item_racks
    where purchase_order_item_id = any(v_items)
    returning warehouse_rack_id
  )
  select coalesce(array_agg(warehouse_rack_id), '{}') into v_racks from removed;

  update purchase_order_items
  set warehouse_rack_id = null, updated_at = now()
  where id = any(v_items);

  update warehouse_racks
  set is_occupied = false, updated_at = now()
  where id = any(v_racks);
end;
$$;

revoke execute on function public.release_order_racks(uuid) from public, anon;
grant execute on function public.release_order_racks(uuid) to authenticated;

commit;


-- Check -----------------------------------------------------------------------
-- Expect your racks, each with a capacity of 10 m³ for now.
select rack_id, name, is_active, is_occupied, capacity_cbm
from public.warehouse_racks
order by rack_id;
