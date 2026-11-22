-- =============================================================================
-- 049: Each product moves on as its own goods arrive
--
-- DMC (2026-11-23): goods that arrive are stored and go straight on to
-- labeling, without waiting for the order's other products. As soon as some of
-- a product's cases are in, the warehouse takes its original label, sales sends
-- it to the customer, the customer sends their design, and it's printed. Its
-- labels are applied once all of its cases are in (or the rest is recorded as
-- not coming), or, in a rush shipment, the cases shipping now. Each product's
-- stage is shown to staff, so they see which products move fast or slow.
-- The order still moves to warehouse preparation once every product is in,
-- and ships once every product's labels are applied (BR-29, BR-30).
-- Safe to run more than once. The last query shows true, true.
-- =============================================================================


-- 1. How far each product's goods have arrived ----------------------------------------------
-- For the label screens: staff, or the order's own customer (no supplier is named).
create or replace function public.order_items_arrival(p_order_ids uuid[])
returns table (item_id uuid, ordered integer, received integer, missing integer, complete boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select i.id,
         l.ordered_quantity,
         coalesce(l.received_quantity, 0),
         coalesce(l.missing_quantity, 0),
         (l.id is null
          or coalesce(lower(trim(l.status)), '') in ('fully delivered', 'delivered short')
          or coalesce(l.received_quantity, 0) + coalesce(l.missing_quantity, 0) >= coalesce(l.ordered_quantity, 0)
          or (i.ship_quantity is not null and coalesce(l.received_quantity, 0) >= i.ship_quantity))
  from customer_order_items i
  join customer_orders o on o.id = i.customer_order_id
  left join lateral public.order_item_line(i.id) x on true
  left join purchase_order_items l on l.id = x.po_item_id
  where i.customer_order_id = any (p_order_ids)
    and (o.customer_id = auth.uid()
         or public.has_role('admin', 'management', 'sales', 'procurement', 'warehouse'));
end;
$$;

revoke execute on function public.order_items_arrival(uuid[]) from public, anon;
grant execute on function public.order_items_arrival(uuid[]) to authenticated;


-- 2. Labels are applied once the product's goods are all in --------------------------------
create or replace function public.refuse_labels_before_goods()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line      uuid;
  v_ordered   integer;
  v_received  integer;
  v_missing   integer;
  v_status    text;
  v_ship      integer;
  v_product   text;
begin
  -- The server's steps and the SQL editor have no signed-in user.
  if auth.uid() is null
     or coalesce(lower(trim(new.status)), '') <> 'applied to units'
     or (tg_op = 'UPDATE' and coalesce(lower(trim(old.status)), '') = 'applied to units') then
    return new;
  end if;

  select x.po_item_id into v_line from public.order_item_line(new.customer_order_item_id) x;
  if v_line is null then
    return new;  -- nothing was bought for it: its goods were already in the warehouse
  end if;

  select l.ordered_quantity, coalesce(l.received_quantity, 0), coalesce(l.missing_quantity, 0), lower(trim(l.status))
    into v_ordered, v_received, v_missing, v_status
  from purchase_order_items l
  where l.id = v_line;

  select i.ship_quantity, p.product_name into v_ship, v_product
  from customer_order_items i
  left join products p on p.id = i.product_id
  where i.id = new.customer_order_item_id;

  if v_status in ('fully delivered', 'delivered short')
     or v_received + v_missing >= coalesce(v_ordered, 0)
     or (v_ship is not null and v_received >= v_ship) then
    return new;
  end if;

  raise exception '% of % cases of % are in. Its labels are applied once all of them are, or the rest is recorded as not coming.',
    v_received, v_ordered, coalesce(v_product, 'this product');
end;
$$;

revoke execute on function public.refuse_labels_before_goods() from public, anon, authenticated;

drop trigger if exists compliance_label_exchanges_goods_in on public.compliance_label_exchanges;
create trigger compliance_label_exchanges_goods_in
  before insert or update of status on public.compliance_label_exchanges
  for each row execute function public.refuse_labels_before_goods();


-- Check: true, true.
select
  to_regprocedure('public.order_items_arrival(uuid[])') is not null as arrival_per_product,
  exists (select 1 from pg_trigger where tgname = 'compliance_label_exchanges_goods_in') as labels_applied_once_goods_in;
