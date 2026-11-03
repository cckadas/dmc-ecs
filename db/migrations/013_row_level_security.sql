-- =============================================================================
-- 013 — Who can see and change what
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm). Safe to re-run.
-- All or nothing: if any line fails, nothing is changed. Run 011 and 012 first.
--
-- Before this, anyone holding the website's public key could read most tables
-- without signing in, and any signed-in customer could read or change every
-- customer's records. Now:
--   - Without signing in: nothing.
--   - Customers: their own records only. They see products, but no supplier, cost
--     or PO data. Quotations and order amounts can't be edited by a customer.
--   - Staff: what their pages need, and they can only change what their role does.
--   - A deactivated account loses its role's access straight away.
--
-- The server's service-role key skips these rules, and its routes check the
-- caller themselves (server/auth.js). The rules on supplier_price_list,
-- market_markups and business_settings (001, 002) stay as they are.
-- =============================================================================

begin;


-- Every table has its rules on ------------------------------------------------
alter table public.compliance_label_exchanges     enable row level security;
alter table public.customer_order_items           enable row level security;
alter table public.customer_order_status_history  enable row level security;
alter table public.customer_orders                enable row level security;
alter table public.delivery_locations             enable row level security;
alter table public.notifications                  enable row level security;
alter table public.products                       enable row level security;
alter table public.profiles                       enable row level security;
alter table public.purchase_order_item_racks      enable row level security;
alter table public.purchase_order_items           enable row level security;
alter table public.purchase_orders                enable row level security;
alter table public.quotation_items                enable row level security;
alter table public.quotation_request_items        enable row level security;
alter table public.quotation_requests             enable row level security;
alter table public.quotations                     enable row level security;
alter table public.supplier_performance           enable row level security;
alter table public.suppliers                      enable row level security;
alter table public.warehouse_racks                enable row level security;


-- Remove the old "any signed-in user" rules on these tables -------------------
do $$
declare
  v_policy record;
begin
  for v_policy in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'compliance_label_exchanges', 'customer_order_items', 'customer_order_status_history',
        'customer_orders', 'delivery_locations', 'notifications', 'products', 'profiles',
        'purchase_order_item_racks', 'purchase_order_items', 'purchase_orders', 'quotation_items',
        'quotation_request_items', 'quotation_requests', 'quotations', 'supplier_performance',
        'suppliers', 'warehouse_racks'
      )
  loop
    execute format('drop policy %I on public.%I', v_policy.policyname, v_policy.tablename);
  end loop;
end;
$$;


-- Admin: everything, on every table above -------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'compliance_label_exchanges', 'customer_order_items', 'customer_order_status_history',
    'customer_orders', 'delivery_locations', 'notifications', 'products', 'profiles',
    'purchase_order_item_racks', 'purchase_order_items', 'purchase_orders', 'quotation_items',
    'quotation_request_items', 'quotation_requests', 'quotations', 'supplier_performance',
    'suppliers', 'warehouse_racks'
  ]
  loop
    execute format(
      'create policy "admin: full access" on public.%I for all to authenticated '
      'using ((select public.has_role(''admin''))) with check ((select public.has_role(''admin'')))',
      v_table
    );
  end loop;
end;
$$;


-- Profiles --------------------------------------------------------------------
-- Nobody can edit their own row, so nobody can raise their own role. Accounts are
-- created by the server. Only admin sees staff accounts.
create policy "anyone: read own profile" on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy "staff: read customers" on public.profiles
  for select to authenticated
  using (
    (select public.has_role('sales', 'procurement', 'warehouse', 'management'))
    and lower(trim(role)) = 'customer'
  );

create policy "sales: edit customers" on public.profiles
  for update to authenticated
  using ((select public.has_role('sales')) and lower(trim(role)) = 'customer')
  with check ((select public.has_role('sales')) and lower(trim(role)) = 'customer');

create policy "sales: delete customers" on public.profiles
  for delete to authenticated
  using ((select public.has_role('sales')) and lower(trim(role)) = 'customer');


-- Delivery locations ----------------------------------------------------------
create policy "customer: read own locations" on public.delivery_locations
  for select to authenticated
  using (profile_id = auth.uid());

create policy "customer: add own locations" on public.delivery_locations
  for insert to authenticated
  with check (profile_id = auth.uid());

create policy "customer: edit own locations" on public.delivery_locations
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "staff: read locations" on public.delivery_locations
  for select to authenticated
  using ((select public.has_role('sales', 'procurement', 'warehouse', 'management')));


-- Products and suppliers ------------------------------------------------------
-- Products hold no prices. Customers get manufacturer names from
-- product_manufacturers() below, never the suppliers table.
create policy "signed in: read products" on public.products
  for select to authenticated
  using (true);

create policy "staff: read suppliers" on public.suppliers
  for select to authenticated
  using ((select public.has_role('sales', 'procurement', 'warehouse', 'management')));

create policy "procurement: maintain suppliers" on public.suppliers
  for all to authenticated
  using ((select public.has_role('procurement')))
  with check ((select public.has_role('procurement')));

create policy "management and procurement: supplier performance" on public.supplier_performance
  for all to authenticated
  using ((select public.has_role('management', 'procurement')))
  with check ((select public.has_role('management', 'procurement')));


-- Quotation requests ----------------------------------------------------------
create policy "customer: read own requests" on public.quotation_requests
  for select to authenticated
  using (customer_id = auth.uid());

create policy "customer: send a request" on public.quotation_requests
  for insert to authenticated
  with check (customer_id = auth.uid() and lower(trim(status)) = 'awaiting pricing');

create policy "customer: cancel an unpriced request" on public.quotation_requests
  for delete to authenticated
  using (customer_id = auth.uid() and lower(trim(status)) = 'awaiting pricing');

create policy "sales: read requests" on public.quotation_requests
  for select to authenticated
  using ((select public.has_role('sales')));

create policy "sales: update requests" on public.quotation_requests
  for update to authenticated
  using ((select public.has_role('sales')))
  with check ((select public.has_role('sales')));

create policy "customer: read own request items" on public.quotation_request_items
  for select to authenticated
  using (exists (
    select 1 from public.quotation_requests r
    where r.id = quotation_request_id and r.customer_id = auth.uid()
  ));

create policy "customer: add items to an unpriced request" on public.quotation_request_items
  for insert to authenticated
  with check (exists (
    select 1 from public.quotation_requests r
    where r.id = quotation_request_id
      and r.customer_id = auth.uid()
      and lower(trim(r.status)) = 'awaiting pricing'
  ));

create policy "customer: remove items from an unpriced request" on public.quotation_request_items
  for delete to authenticated
  using (exists (
    select 1 from public.quotation_requests r
    where r.id = quotation_request_id
      and r.customer_id = auth.uid()
      and lower(trim(r.status)) = 'awaiting pricing'
  ));

create policy "sales: read request items" on public.quotation_request_items
  for select to authenticated
  using ((select public.has_role('sales')));


-- Quotations ------------------------------------------------------------------
-- Customers only read them. Approving and rejecting go through approve_quotation()
-- and reject_quotation() (011), so a customer can't change a quotation's amounts.
create policy "customer: read own quotations" on public.quotations
  for select to authenticated
  using (exists (
    select 1 from public.quotation_requests r
    where r.id = quotation_request_id and r.customer_id = auth.uid()
  ));

create policy "sales: read quotations" on public.quotations
  for select to authenticated
  using ((select public.has_role('sales')));

create policy "sales: create quotations" on public.quotations
  for insert to authenticated
  with check ((select public.has_role('sales')));

create policy "sales: update quotations" on public.quotations
  for update to authenticated
  using ((select public.has_role('sales')))
  with check ((select public.has_role('sales')));

-- Only to undo a quotation whose items failed to save.
create policy "sales: remove an unanswered quotation" on public.quotations
  for delete to authenticated
  using ((select public.has_role('sales')) and lower(trim(status)) = 'pending approval');

create policy "customer: read own quotation items" on public.quotation_items
  for select to authenticated
  using (exists (
    select 1
    from public.quotations q
    join public.quotation_requests r on r.id = q.quotation_request_id
    where q.id = quotation_id and r.customer_id = auth.uid()
  ));

create policy "sales: read quotation items" on public.quotation_items
  for select to authenticated
  using ((select public.has_role('sales')));

create policy "sales: add quotation items" on public.quotation_items
  for insert to authenticated
  with check ((select public.has_role('sales')));


-- Customer orders -------------------------------------------------------------
-- Created only by approve_quotation() (011), which copies the amounts from the
-- quotation. protect_order_payments below limits what each role can change.
create policy "customer: read own orders" on public.customer_orders
  for select to authenticated
  using (customer_id = auth.uid());

create policy "customer: submit a payment on own orders" on public.customer_orders
  for update to authenticated
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

create policy "staff: read orders" on public.customer_orders
  for select to authenticated
  using ((select public.has_role('sales', 'procurement', 'warehouse', 'management')));

create policy "staff: update orders" on public.customer_orders
  for update to authenticated
  using ((select public.has_role('sales', 'procurement', 'warehouse')))
  with check ((select public.has_role('sales', 'procurement', 'warehouse')));

create policy "sales: delete orders with a rejected payment" on public.customer_orders
  for delete to authenticated
  using ((select public.has_role('sales')) and lower(trim(status)) = 'payment rejected');

create policy "customer: read own order items" on public.customer_order_items
  for select to authenticated
  using (exists (
    select 1 from public.customer_orders o
    where o.id = customer_order_id and o.customer_id = auth.uid()
  ));

create policy "staff: read order items" on public.customer_order_items
  for select to authenticated
  using ((select public.has_role('sales', 'procurement', 'warehouse', 'management')));

create policy "sales: delete items of orders with a rejected payment" on public.customer_order_items
  for delete to authenticated
  using (
    (select public.has_role('sales'))
    and exists (
      select 1 from public.customer_orders o
      where o.id = customer_order_id and lower(trim(o.status)) = 'payment rejected'
    )
  );

create policy "customer: read own order history" on public.customer_order_status_history
  for select to authenticated
  using (exists (
    select 1 from public.customer_orders o
    where o.id = customer_order_id and o.customer_id = auth.uid()
  ));

-- A customer's only step of their own: submitting the first payment.
create policy "customer: record a submitted payment" on public.customer_order_status_history
  for insert to authenticated
  with check (
    lower(trim(new_status)) = 'submitted'
    and exists (
      select 1 from public.customer_orders o
      where o.id = customer_order_id and o.customer_id = auth.uid()
    )
  );

create policy "staff: read order history" on public.customer_order_status_history
  for select to authenticated
  using ((select public.has_role('sales', 'procurement', 'warehouse', 'management')));

create policy "staff: record order history" on public.customer_order_status_history
  for insert to authenticated
  with check ((select public.has_role('sales', 'procurement', 'warehouse')));


-- What each role can change on an order ---------------------------------------
-- Customers: only their payment details, and only a first payment changes the
-- status. Staff other than sales and admin: never the money.
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
    or new.down_payment_amount is distinct from old.down_payment_amount
    or new.customer_id is distinct from old.customer_id
  ) then
    raise exception 'Only sales or admin can confirm payments or change an order''s amounts.';
  end if;

  return new;
end;
$$;


-- Purchase orders -------------------------------------------------------------
create policy "staff: read purchase orders" on public.purchase_orders
  for select to authenticated
  using ((select public.has_role('sales', 'procurement', 'warehouse', 'management')));

create policy "procurement: create purchase orders" on public.purchase_orders
  for insert to authenticated
  with check ((select public.has_role('procurement')));

create policy "procurement and warehouse: update purchase orders" on public.purchase_orders
  for update to authenticated
  using ((select public.has_role('procurement', 'warehouse')))
  with check ((select public.has_role('procurement', 'warehouse')));

-- Only to undo a PO whose lines failed to save.
create policy "procurement: remove purchase orders" on public.purchase_orders
  for delete to authenticated
  using ((select public.has_role('procurement')));

create policy "staff: read purchase order lines" on public.purchase_order_items
  for select to authenticated
  using ((select public.has_role('sales', 'procurement', 'warehouse', 'management')));

create policy "procurement: add purchase order lines" on public.purchase_order_items
  for insert to authenticated
  with check ((select public.has_role('procurement')));

create policy "procurement and warehouse: update purchase order lines" on public.purchase_order_items
  for update to authenticated
  using ((select public.has_role('procurement', 'warehouse')))
  with check ((select public.has_role('procurement', 'warehouse')));


-- Warehouse -------------------------------------------------------------------
-- Which rack holds what is only written by receive_purchase_order_item() and
-- release_order_racks() (012).
create policy "staff: read racks" on public.warehouse_racks
  for select to authenticated
  using ((select public.has_role('sales', 'procurement', 'warehouse', 'management')));

create policy "warehouse: update racks" on public.warehouse_racks
  for update to authenticated
  using ((select public.has_role('warehouse')))
  with check ((select public.has_role('warehouse')));

create policy "staff: read rack contents" on public.purchase_order_item_racks
  for select to authenticated
  using ((select public.has_role('sales', 'procurement', 'warehouse', 'management')));


-- Compliance labels -----------------------------------------------------------
create policy "customer: read own labels" on public.compliance_label_exchanges
  for select to authenticated
  using (exists (
    select 1
    from public.customer_order_items i
    join public.customer_orders o on o.id = i.customer_order_id
    where i.id = customer_order_item_id and o.customer_id = auth.uid()
  ));

-- A customer's only step: handing in their translated design.
create policy "customer: add own design" on public.compliance_label_exchanges
  for insert to authenticated
  with check (
    lower(trim(status)) = 'customer design label received'
    and exists (
      select 1
      from public.customer_order_items i
      join public.customer_orders o on o.id = i.customer_order_id
      where i.id = customer_order_item_id and o.customer_id = auth.uid()
    )
  );

create policy "customer: update own design" on public.compliance_label_exchanges
  for update to authenticated
  using (exists (
    select 1
    from public.customer_order_items i
    join public.customer_orders o on o.id = i.customer_order_id
    where i.id = customer_order_item_id and o.customer_id = auth.uid()
  ))
  with check (
    lower(trim(status)) = 'customer design label received'
    and exists (
      select 1
      from public.customer_order_items i
      join public.customer_orders o on o.id = i.customer_order_id
      where i.id = customer_order_item_id and o.customer_id = auth.uid()
    )
  );

create policy "staff: read labels" on public.compliance_label_exchanges
  for select to authenticated
  using ((select public.has_role('sales', 'procurement', 'warehouse', 'management')));

create policy "warehouse: add labels" on public.compliance_label_exchanges
  for insert to authenticated
  with check ((select public.has_role('warehouse')));

create policy "sales and warehouse: update labels" on public.compliance_label_exchanges
  for update to authenticated
  using ((select public.has_role('sales', 'warehouse')))
  with check ((select public.has_role('sales', 'warehouse')));


-- Notifications ---------------------------------------------------------------
-- A customer's are addressed to them. Staff ones are addressed to a role, and
-- admin sees all staff ones. Any staff member can notify anyone; a customer can
-- only notify staff.
create policy "customer: read own notifications" on public.notifications
  for select to authenticated
  using (lower(trim(role)) = 'customer' and user_id = auth.uid());

create policy "customer: mark own notifications read" on public.notifications
  for update to authenticated
  using (lower(trim(role)) = 'customer' and user_id = auth.uid())
  with check (lower(trim(role)) = 'customer' and user_id = auth.uid());

create policy "customer: notify staff" on public.notifications
  for insert to authenticated
  with check (
    (select public.has_role('customer'))
    and user_id = auth.uid()
    and lower(trim(role)) <> 'customer'
  );

create policy "staff: read own role's notifications" on public.notifications
  for select to authenticated
  using (
    (select public.has_role('sales', 'procurement', 'warehouse', 'management'))
    and lower(trim(role)) = (select public.my_role())
  );

create policy "staff: mark own role's notifications read" on public.notifications
  for update to authenticated
  using (
    (select public.has_role('sales', 'procurement', 'warehouse', 'management'))
    and lower(trim(role)) = (select public.my_role())
  )
  with check (
    (select public.has_role('sales', 'procurement', 'warehouse', 'management'))
    and lower(trim(role)) = (select public.my_role())
  );

create policy "staff: notify anyone" on public.notifications
  for insert to authenticated
  with check ((select public.has_role('sales', 'procurement', 'warehouse', 'management')));


-- Manufacturer names for the catalog ------------------------------------------
-- Customers can't read suppliers, so this gives them what the catalog shows and
-- nothing else: manufacturers only, without contact details. A distributor is
-- DMC's own sourcing and stays private.
create or replace function public.product_manufacturers()
returns table (product_id uuid, manufacturer_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, s.supplier_name
  from products p
  join suppliers s on s.id = p.supplier_id
  where lower(trim(s.supplier_type)) = 'manufacturer'
$$;

revoke execute on function public.product_manufacturers() from public, anon;
grant execute on function public.product_manufacturers() to authenticated;


-- Status history for estimates ------------------------------------------------
-- An order's estimated ready date is learned from every order's timings, while a
-- customer can only read their own history. So this returns all the timings, with
-- other customers' order IDs replaced by a stand-in. Nothing here identifies them.
create or replace function public.status_history_for_estimates()
returns table (customer_order_id uuid, previous_status text, new_status text, changed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when public.my_role() <> 'customer' or o.customer_id = auth.uid() then h.customer_order_id
      else md5(h.customer_order_id::text)::uuid
    end,
    h.previous_status,
    h.new_status,
    h.changed_at
  from customer_order_status_history h
  join customer_orders o on o.id = h.customer_order_id
  where public.my_role() is not null
  order by h.changed_at
$$;

revoke execute on function public.status_history_for_estimates() from public, anon;
grant execute on function public.status_history_for_estimates() to authenticated;

commit;


-- Check -----------------------------------------------------------------------
-- Expect true on every row, and at least one rule per table.
select c.relname as table_name, c.relrowsecurity as rules_on, count(p.policyname) as rules
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by c.relname;
