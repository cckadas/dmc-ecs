-- =============================================================================
-- 022 — A rack is freed as soon as its goods are loaded into the container
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm), after 021.
-- Safe to re-run.
--
-- Racks used to be freed only when the order was marked shipped. But once a
-- product's goods are loaded into the container, its racks can take the next
-- delivery, or the overflow on the floor, even before the truck leaves. So at
-- Staging each product can be marked loaded, which frees its racks at once.
--
-- Loading only frees space. Shipping works as before (every item's labels
-- applied, db/migrations/021) and frees whatever wasn't marked loaded, so this
-- holds whether DMC ships an order all at once or in parts.
--
-- load_order_items(order, products): warehouse staff (and admin) only; only an
-- order in warehouse preparation or ready for shipment; only products of that
-- order whose labels are applied. Products already loaded are left as they are.
-- With no products given, every product of the order not loaded yet.
-- =============================================================================

begin;

alter table public.customer_order_items
  add column if not exists loaded_at timestamptz;

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
  v_freed     integer;
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

  -- The products to load: those asked for (else all of the order's), not loaded yet.
  select coalesce(array_agg(i.id), '{}'), coalesce(array_agg(distinct i.product_id), '{}')
    into v_items, v_products
  from customer_order_items i
  where i.customer_order_id = p_customer_order_id
    and (p_item_ids is null or i.id = any(p_item_ids))
    and i.loaded_at is null;

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

commit;


-- Check -----------------------------------------------------------------------
-- Expect one row: loading_frees_racks true.
select exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'customer_order_items' and column_name = 'loaded_at'
       )
   and exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'load_order_items' and p.prosecdef
       ) as loading_frees_racks;
