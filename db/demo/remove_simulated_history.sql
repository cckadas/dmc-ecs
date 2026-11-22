-- =============================================================================
-- Remove the simulated history
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm) whenever you
-- want the made-up records gone. Safe to re-run. All or nothing.
--
-- Deletes only what db/demo/simulated_history.sql added: orders numbered
-- SIM-ORD-…, POs numbered SIM-PO-… and the made-up customers
-- (@simulated.example.com), with anything made while signed in as one of them
-- during a demo (their requests, quotations, orders and those orders' POs).
-- Their lines, deliveries, status changes, labels and alerts go with them.
-- Real orders, POs and customers aren't touched.
-- The saved prediction model goes too: it learned from the made-up records.
-- The Predictive Analytics page trains a new one once there are enough real ones.
-- =============================================================================

begin;

-- The made-up customers, and their orders.
create temp table sim_customers on commit drop as
select id from public.profiles where email like '%@simulated.example.com';

create temp table sim_orders on commit drop as
select id from public.customer_orders
where order_number like 'SIM-ORD-%'
   or customer_id in (select id from sim_customers);

-- Racks that held simulated goods (only if staff stored some during a demo).
create temp table sim_racks on commit drop as
select distinct r.warehouse_rack_id
from public.purchase_order_item_racks r
join public.purchase_order_items i on i.id = r.purchase_order_item_id
join public.purchase_orders p on p.id = i.purchase_order_id
where p.po_number like 'SIM-PO-%'
   or p.customer_order_id in (select id from sim_orders);

delete from public.purchase_orders
where po_number like 'SIM-PO-%'
   or customer_order_id in (select id from sim_orders);
delete from public.customer_orders where id in (select id from sim_orders);
delete from public.quotations
where quotation_request_id in (select id from public.quotation_requests where customer_id in (select id from sim_customers));
delete from public.quotation_requests where customer_id in (select id from sim_customers);

-- The customers themselves (their saved locations go with them). Since
-- db/migrations/038 a profile no longer goes when its sign-in is deleted.
do $$
begin
  if to_regclass('public.customer_account_changes') is not null then
    delete from public.customer_account_changes where customer_id in (select id from sim_customers);
  end if;
end $$;
delete from public.profiles where id in (select id from sim_customers);
delete from auth.users where email like '%@simulated.example.com';

-- The model trained on them (if db/migrations/019 has been run).
do $$
begin
  if to_regclass('public.prediction_models') is not null then
    delete from public.prediction_models;
  end if;
end $$;

-- Those racks are free again, unless real goods share them.
update public.warehouse_racks w
set is_occupied = false, updated_at = now()
where w.id in (select warehouse_rack_id from sim_racks)
  and not exists (select 1 from public.purchase_order_item_racks r where r.warehouse_rack_id = w.id);

commit;


-- Check -----------------------------------------------------------------------
-- Expect three zeros.
select
  (select count(*) from public.customer_orders where order_number like 'SIM-%') as simulated_orders,
  (select count(*) from public.purchase_orders where po_number like 'SIM-%') as simulated_pos,
  (select count(*) from public.profiles where email like '%@simulated.example.com') as simulated_customers;
