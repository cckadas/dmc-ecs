-- =============================================================================
-- 025  Recording when a container arrives
--
-- The adviser (Nov 10): the system should record when each container arrives,
-- so the predictions learn the days at sea to each country from the system's
-- own records, instead of sailing days typed in from DMC. Once an order has
-- shipped, sales, warehouse or admin records the day its container arrived
-- (from the shipping line's notice or the customer's word). The system keeps
-- that day, and when and by whom it was recorded. Recording it again corrects it.
--
-- The order stays "shipped": arriving isn't a step DMC works on, so every
-- screen and report that treats shipped as done is unchanged.
--
-- Safe to run more than once. The last query shows arrivals_recorded = true.
-- =============================================================================

alter table public.customer_orders
  add column if not exists arrived_on date,
  add column if not exists arrival_recorded_at timestamptz,
  add column if not exists arrival_recorded_by uuid;


-- Records (or corrects) the day a shipped order's container arrived. Returns
-- the order number, the day, and its days at sea.
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

  if lower(trim(v_order.status)) <> 'shipped' then
    raise exception 'Only a shipped order can arrive. % is %.', v_order.order_number, v_order.status;
  end if;

  if p_arrived_on is null then
    raise exception 'Enter the day the container arrived.';
  end if;

  if p_arrived_on > v_today then
    raise exception 'The arrival day can''t be in the future.';
  end if;

  -- The day it shipped, in the Philippines.
  select (max(changed_at) at time zone 'Asia/Manila')::date into v_shipped_on
  from customer_order_status_history
  where customer_order_id = p_customer_order_id
    and lower(trim(new_status)) = 'shipped';

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


-- Check: arrivals_recorded = true.
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customer_orders' and column_name = 'arrived_on'
  )
    and to_regprocedure('public.record_order_arrival(uuid, date)') is not null
    as arrivals_recorded;
