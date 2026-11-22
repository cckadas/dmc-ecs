-- =============================================================================
-- 021 — Mark as Shipped in one step
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm), after 020.
-- Safe to re-run.
--
-- Staging used to mark an order as shipped in several separate steps: free its
-- racks, change its status, record the change. If one failed halfway, or
-- someone clicked twice, the steps ran again: racks freed twice, a second
-- "shipped" record. And the labels were checked only when the page loaded, so
-- one undone since could slip through.
--
-- ship_customer_order() does it all at once, or not at all:
--   - only warehouse staff (and admin)
--   - only an order in warehouse preparation or ready for shipment, never one
--     already shipped (a second click waits, then is refused)
--   - only when every item's labels are applied, checked at that moment
--   - frees its racks, marks it shipped today (Philippine date) and records it
-- With p_check_only, it runs the checks and changes nothing, so the page can
-- refuse before it makes the shipping documents.
-- =============================================================================

begin;

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

  if lower(trim(v_order.status)) not in ('warehouse preparation', 'ready for shipment') then
    raise exception 'Only an order in warehouse preparation or ready for shipment can be shipped.';
  end if;

  -- Every item's labels applied, as of now.
  select count(*),
         count(*) filter (where exists (
           select 1 from compliance_label_exchanges e
           where e.customer_order_item_id = i.id and lower(trim(e.status)) = 'applied to units'
         ))
    into v_items, v_applied
  from customer_order_items i
  where i.customer_order_id = p_customer_order_id;

  if v_items = 0 or v_applied < v_items then
    raise exception 'Labels are applied on % of % items. Every item needs its labels applied before shipping.', v_applied, v_items;
  end if;

  if not p_check_only then
    perform public.release_order_racks(p_customer_order_id);

    update customer_orders
    set status = 'shipped',
        estimated_ship_date = (now() at time zone 'Asia/Manila')::date
    where id = p_customer_order_id;

    insert into customer_order_status_history (customer_order_id, previous_status, new_status, changed_at)
    values (p_customer_order_id, v_order.status, 'shipped', now());
  end if;

  return query select v_order.customer_id, v_order.order_number;
end;
$$;

revoke execute on function public.ship_customer_order(uuid, boolean) from public, anon;
grant execute on function public.ship_customer_order(uuid, boolean) to authenticated;

commit;


-- Check -----------------------------------------------------------------------
-- Expect one row: ship_in_one_step true.
select exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ship_customer_order' and p.prosecdef
) as ship_in_one_step;
