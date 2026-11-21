-- =============================================================================
-- 020 — A customer gets only their own orders' status history
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm), after 019.
-- Safe to re-run.
--
-- status_history_for_estimates() gave a customer every order's status changes
-- (other customers' order IDs hidden), for estimates worked out in their
-- browser. Customers' estimates now come from DMC's server, and customers
-- should never see how long DMC's orders take or how many ran late. So a
-- customer now gets only their own orders' changes. Staff still get them all.
-- =============================================================================

begin;

create or replace function public.status_history_for_estimates()
returns table (customer_order_id uuid, previous_status text, new_status text, changed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select h.customer_order_id, h.previous_status, h.new_status, h.changed_at
  from customer_order_status_history h
  join customer_orders o on o.id = h.customer_order_id
  where public.my_role() is not null
    and (public.my_role() <> 'customer' or o.customer_id = auth.uid())
  order by h.changed_at, h.id
$$;

revoke execute on function public.status_history_for_estimates() from public, anon;
grant execute on function public.status_history_for_estimates() to authenticated;

commit;


-- Check -----------------------------------------------------------------------
-- Expect one row: own_orders_only true.
select position('o.customer_id = auth.uid()' in pg_get_functiondef('public.status_history_for_estimates()'::regprocedure)) > 0
   and position('md5' in pg_get_functiondef('public.status_history_for_estimates()'::regprocedure)) = 0 as own_orders_only;
