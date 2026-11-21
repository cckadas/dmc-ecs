-- =============================================================================
-- 043: Warehouse floors and pallet slots (simulated from DMC's floor sizes)
--
-- DMC counts its warehouse space in 40-ft high cubes' worth per floor: 1st floor
-- 10, 2nd 8, 3rd 2 (the newest, its racks still being finished). Goods sit on
-- pallets of 1.2 m x 1.0 m on shelves 2 m high, so one pallet spot (a slot)
-- holds up to 2.4 m³ of cases. One 40-ft high cube (76.3 m³) is about 32 slots,
-- so this script makes the slots DMC's numbers give, until DMC counts its real
-- ones: 317 on the 1st floor (F1-001 to F1-317), 254 on the 2nd, 63 on the 3rd.
-- They are the system's racks from now on: the 13 test racks are replaced, and
-- the goods on them move to slots.
--
-- A slot holds goods of ONE customer order, but several products of that order
-- may share it (DMC, 2026-11-22): whole pallets of one product first, then what
-- is left of several products of the same order together, instead of a
-- half-empty pallet per product. What a slot holds is counted from the cases
-- (cases x each product's volume per case, up to 2.4 m³), so a product needs
-- its volume per case before it can be received. The database refuses another
-- order's goods in a slot, and more than fits, however the goods are recorded.
--
-- Admin adds slots, or a new floor, on Warehouse Locations. Safe to run more
-- than once. The last query shows true, true, true and the slots per floor.
-- =============================================================================


-- 1. Floors ------------------------------------------------------------------------------------
alter table public.warehouse_racks add column if not exists floor integer;
alter table public.warehouse_racks add column if not exists is_simulated boolean not null default false;
alter table public.warehouse_racks drop constraint if exists warehouse_racks_floor_positive;
alter table public.warehouse_racks add constraint warehouse_racks_floor_positive check (floor is null or floor > 0);


-- 2. The slots DMC's floor sizes give ------------------------------------------------------------
insert into public.warehouse_racks (rack_id, name, location, capacity_cbm, floor, is_simulated, is_active, is_occupied)
select format('F%s-%s', f.floor, lpad(n::text, 3, '0')),
       format('F%s-%s', f.floor, lpad(n::text, 3, '0')),
       format('Floor %s', f.floor),
       2.4, f.floor, true, true, false
from (values (1, 317), (2, 254), (3, 63)) as f(floor, slots)
cross join lateral generate_series(1, f.slots) as n
on conflict (rack_id) do nothing;


-- 3. One order per slot, and no more than fits, however the goods are recorded ---------------
create or replace function public.check_slot_contents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot   warehouse_racks%rowtype;
  v_order  uuid;
  v_cbm    numeric;
  v_other  text;
  v_used   numeric;
begin
  select * into v_slot from warehouse_racks where id = new.warehouse_rack_id;

  select p.customer_order_id, pr.cbm into v_order, v_cbm
  from purchase_order_items i
  join purchase_orders p on p.id = i.purchase_order_id
  left join products pr on pr.id = i.product_id
  where i.id = new.purchase_order_item_id;

  select string_agg(distinct coalesce(o.order_number, 'another order'), ', ') into v_other
  from purchase_order_item_racks r
  join purchase_order_items i on i.id = r.purchase_order_item_id
  join purchase_orders p on p.id = i.purchase_order_id
  left join customer_orders o on o.id = p.customer_order_id
  where r.warehouse_rack_id = new.warehouse_rack_id
    and r.purchase_order_item_id <> new.purchase_order_item_id
    and p.customer_order_id is distinct from v_order;

  if v_other is not null then
    raise exception 'Slot % holds goods of %. A slot holds one order''s goods only.', coalesce(v_slot.name, v_slot.rack_id), v_other;
  end if;

  select coalesce(sum(r.quantity * coalesce(pr.cbm, 0)), 0) into v_used
  from purchase_order_item_racks r
  join purchase_order_items i on i.id = r.purchase_order_item_id
  left join products pr on pr.id = i.product_id
  where r.warehouse_rack_id = new.warehouse_rack_id
    and r.purchase_order_item_id <> new.purchase_order_item_id;

  if v_used + new.quantity * coalesce(v_cbm, 0) > v_slot.capacity_cbm + 0.000001 then
    raise exception 'Slot % can''t hold that: % m³ of goods in a % m³ slot.',
      coalesce(v_slot.name, v_slot.rack_id), round(v_used + new.quantity * coalesce(v_cbm, 0), 2), v_slot.capacity_cbm;
  end if;

  return new;
end;
$$;

revoke execute on function public.check_slot_contents() from public, anon, authenticated;

drop trigger if exists purchase_order_item_racks_slot_contents on public.purchase_order_item_racks;
create trigger purchase_order_item_racks_slot_contents
  before insert or update on public.purchase_order_item_racks
  for each row execute function public.check_slot_contents();


-- 4. The goods on the old test racks move to slots, then those racks go -----------------------
-- Each order's goods are packed into the first free slots, the 1st floor first,
-- its products sharing a slot while they fit.
do $$
declare
  v_order  record;
  v_place  record;
  v_slot   uuid;
  v_free   numeric;
  v_left   integer;
  v_fit    integer;
begin
  for v_order in
    select distinct p.customer_order_id as id
    from purchase_order_item_racks r
    join warehouse_racks w on w.id = r.warehouse_rack_id
    join purchase_order_items i on i.id = r.purchase_order_item_id
    join purchase_orders p on p.id = i.purchase_order_id
    where w.floor is null
  loop
    v_slot := null;
    v_free := 0;

    for v_place in
      select r.id, r.purchase_order_item_id as line, r.quantity, coalesce(pr.cbm, 0) as cbm
      from purchase_order_item_racks r
      join warehouse_racks w on w.id = r.warehouse_rack_id
      join purchase_order_items i on i.id = r.purchase_order_item_id
      join purchase_orders p on p.id = i.purchase_order_id
      left join products pr on pr.id = i.product_id
      where w.floor is null
        and p.customer_order_id is not distinct from v_order.id
      order by i.id, r.id
    loop
      v_left := v_place.quantity;

      while v_left > 0 loop
        if v_slot is null or (v_place.cbm > 0 and v_free + 0.000001 < v_place.cbm) then
          select w.id into v_slot
          from warehouse_racks w
          where w.floor is not null
            and w.is_active
            and not w.is_occupied
            and not exists (select 1 from purchase_order_item_racks x where x.warehouse_rack_id = w.id)
          order by w.floor, w.rack_id
          limit 1;

          if v_slot is null then
            raise exception 'Not enough free slots to move the goods on the old racks.';
          end if;

          select capacity_cbm into v_free from warehouse_racks where id = v_slot;
          update warehouse_racks set is_occupied = true, updated_at = now() where id = v_slot;
        end if;

        v_fit := case
          when v_place.cbm > 0 then least(v_left, floor((v_free + 0.000001) / v_place.cbm)::integer)
          else v_left
        end;

        insert into purchase_order_item_racks (purchase_order_item_id, warehouse_rack_id, quantity)
        values (v_place.line, v_slot, v_fit)
        on conflict (purchase_order_item_id, warehouse_rack_id)
          do update set quantity = purchase_order_item_racks.quantity + excluded.quantity;

        v_free := v_free - v_fit * v_place.cbm;
        v_left := v_left - v_fit;
      end loop;

      delete from purchase_order_item_racks where id = v_place.id;
    end loop;
  end loop;

  -- Each line's first slot, where the screens look for one.
  update purchase_order_items i
  set warehouse_rack_id = (
        select r.warehouse_rack_id
        from purchase_order_item_racks r
        join warehouse_racks w on w.id = r.warehouse_rack_id
        where r.purchase_order_item_id = i.id
        order by w.floor, w.rack_id
        limit 1),
      updated_at = now()
  where i.warehouse_rack_id in (select id from warehouse_racks where floor is null);

  -- The old racks, empty now, are removed.
  delete from warehouse_racks w
  where w.floor is null
    and not exists (select 1 from purchase_order_item_racks r where r.warehouse_rack_id = w.id)
    and not exists (select 1 from purchase_order_items i where i.warehouse_rack_id = w.id);
end;
$$;


-- 5. Receiving into slots ----------------------------------------------------------------------
-- As in 034, with slots: the product needs its volume per case; a slot may
-- already hold goods of the same order (any product), never another order's;
-- and what's in it, counted from the cases, can't go over 2.4 m³.
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
  v_rack_ids    uuid[] := '{}';
  v_released    uuid[];
  v_status      text;
  v_ordered     integer;
  v_received    integer;
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

  select cbm, coalesce(unit, 'unit'), product_name into v_cbm, v_unit, v_product from products where id = v_item.product_id;
  select customer_order_id into v_line_order from purchase_orders where id = v_item.purchase_order_id;

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


-- Check: true, true, true, then the slots per floor (1st 317, 2nd 254, 3rd 63
-- unless admin has added more).
select
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'warehouse_racks' and column_name = 'floor') as floors_kept,
  exists (select 1 from pg_trigger
          where tgname = 'purchase_order_item_racks_slot_contents'
            and tgrelid = 'public.purchase_order_item_racks'::regclass) as one_order_per_slot,
  not exists (select 1 from public.warehouse_racks where floor is null) as old_racks_replaced,
  (select string_agg(format('Floor %s: %s slots', floor, n), ', ' order by floor)
   from (select floor, count(*) as n from public.warehouse_racks where floor is not null group by floor) x) as slots_per_floor;
