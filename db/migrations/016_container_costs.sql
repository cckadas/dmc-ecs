-- =============================================================================
-- 016 — Container cost and fixed shipping cost on every quotation
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm), after 015.
-- Safe to re-run. All or nothing: if any line fails, nothing is changed.
--
-- DMC: a quotation is charged two separate fixed amounts:
--   container cost = a fixed price for each container size
--   shipping cost  = a fixed amount for each destination country (the Default
--                    row for countries without their own)
-- They replace the old shipping rate per unit.
--
-- The order's container is the smallest size that holds the total volume and
-- weight of its cases (products.cbm and gross_weight_kg x quantity); the customer
-- may choose a bigger one. Volume is filled up to the container_fill_percent
-- setting. Sales can't type either amount: the database sets both from these
-- settings whenever a quotation is saved, along with the total and the 50% down
-- payment.
-- =============================================================================

begin;


-- Container sizes -------------------------------------------------------------
-- Inside volume and weight limits are the global standard sizes DMC gave.
create table if not exists public.container_sizes (
  code           text primary key,
  name           text not null,
  inside_cbm     numeric(8, 2) not null check (inside_cbm > 0),
  max_weight_kg  numeric(10, 2) not null check (max_weight_kg > 0),
  cost           numeric(12, 2) check (cost is null or cost >= 0),
  sort_order     integer not null,
  updated_by     uuid references public.profiles (id) on delete set null,
  updated_at     timestamptz not null default now()
);

-- PLACEHOLDER costs until DMC gives the real ones. Never overwrites a size that
-- already exists, so re-running keeps any cost someone has set.
insert into public.container_sizes (code, name, inside_cbm, max_weight_kg, cost, sort_order)
values
  ('20-ft', '20-ft standard', 33.2, 30000, 80000, 1),
  ('40-ft', '40-ft standard', 67.7, 32500, 120000, 2),
  ('40-ft HC', '40-ft high cube', 76.3, 32500, 130000, 3)
on conflict (code) do nothing;

alter table public.container_sizes enable row level security;

-- Customers read it too: their quotations name the container.
drop policy if exists "signed in: read container sizes" on public.container_sizes;
create policy "signed in: read container sizes" on public.container_sizes
  for select to authenticated
  using (true);

drop policy if exists "admin and management: maintain container sizes" on public.container_sizes;
create policy "admin and management: maintain container sizes" on public.container_sizes
  for all to authenticated
  using ((select public.has_role('admin', 'management')))
  with check ((select public.has_role('admin', 'management')));

-- How full a container's volume may be packed, in percent. Cases rarely fill
-- every corner, so DMC can lower it.
insert into public.business_settings (key, value)
values ('container_fill_percent', 100)
on conflict (key) do nothing;


-- Shipping: one fixed amount per country --------------------------------------
alter table public.market_markups
  add column if not exists shipping_cost numeric(12, 2)
    check (shipping_cost is null or shipping_cost >= 0);

-- PLACEHOLDER amounts until DMC gives the real ones. Only fills empty ones.
update public.market_markups set shipping_cost = 150000
where lower(trim(country)) = 'default' and shipping_cost is null;

update public.market_markups set shipping_cost = 120000
where lower(trim(country)) = 'hong kong' and shipping_cost is null;

alter table public.market_markups drop column if exists shipping_per_unit;


-- Each quotation and order records its container ------------------------------
alter table public.quotations
  add column if not exists container_size text references public.container_sizes (code) on update cascade,
  add column if not exists container_cost numeric(12, 2);

alter table public.customer_orders
  add column if not exists container_size text references public.container_sizes (code) on update cascade,
  add column if not exists container_cost numeric(12, 2);


-- The database sets the charges itself -----------------------------------------
-- Container cost from the chosen size, shipping from the delivery country, then
-- total = subtotal + both, and the down payment = half the total.
create or replace function public.set_quotation_charges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country    text;
  v_container  numeric;
  v_shipping   numeric;
begin
  if new.container_size is null then
    raise exception 'Choose the container for this quotation.';
  end if;

  select cost into v_container from container_sizes where code = new.container_size;

  if not found then
    raise exception 'There is no % container.', new.container_size;
  end if;

  if v_container is null then
    raise exception 'The % container has no cost yet. Admin or management must set it in Markups & Credit.', new.container_size;
  end if;

  select l.country into v_country
  from quotation_requests r
  left join delivery_locations l on l.id = r.delivery_location_id
  where r.id = new.quotation_request_id;

  -- The country's own row, or the Default row for a country without one.
  select m.shipping_cost into v_shipping
  from market_markups m
  where lower(trim(m.country)) in (lower(trim(coalesce(v_country, ''))), 'default')
  order by lower(trim(m.country)) = 'default'
  limit 1;

  if v_shipping is null then
    raise exception 'There is no shipping cost for % yet. Admin or management must set it in Markups & Credit.', coalesce(v_country, 'this country');
  end if;

  new.container_cost := v_container;
  new.shipping_cost := v_shipping;
  new.total_amount := coalesce(new.subtotal, 0) + v_container + v_shipping;
  new.down_payment_amount := round(new.total_amount * 0.5, 2);

  return new;
end;
$$;

drop trigger if exists quotations_charges on public.quotations;
create trigger quotations_charges
  before insert or update of container_size, container_cost, shipping_cost, subtotal, total_amount, down_payment_amount
  on public.quotations
  for each row execute function public.set_quotation_charges();


-- Approving a quotation copies the container onto the order ---------------------
-- As in 011, with container_size and container_cost added.
create or replace function public.approve_quotation(p_quotation_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quotation  quotations%rowtype;
  v_request    quotation_requests%rowtype;
  v_order_id   uuid;
  v_number     text;
begin
  select * into v_quotation from quotations where id = p_quotation_id for update;

  if not found then
    raise exception 'This quotation no longer exists.';
  end if;

  select * into v_request from quotation_requests where id = v_quotation.quotation_request_id;

  if v_request.customer_id is distinct from auth.uid() then
    raise exception 'This quotation belongs to another customer.';
  end if;

  if lower(trim(v_quotation.status)) <> 'pending approval' then
    raise exception 'This quotation has already been %.', lower(trim(v_quotation.status));
  end if;

  if v_quotation.expiry_date < (now() at time zone 'Asia/Manila')::date then
    raise exception 'This quotation has expired. Please request a refreshed quote before approving.';
  end if;

  v_number := next_document_number('ORD');

  insert into customer_orders (
    order_number, customer_id, quotation_id, quotation_number, subtotal, shipping_cost,
    container_size, container_cost, total_amount, down_payment_amount, delivery_location_id,
    pfi_file_path, expiry_date, status
  )
  values (
    v_number, v_request.customer_id, v_quotation.id, v_quotation.quotation_number,
    v_quotation.subtotal, v_quotation.shipping_cost, v_quotation.container_size,
    v_quotation.container_cost, v_quotation.total_amount, v_quotation.down_payment_amount,
    v_request.delivery_location_id, v_quotation.pfi_file_path, v_quotation.expiry_date,
    'pending payment'
  )
  returning id into v_order_id;

  insert into customer_order_items (customer_order_id, product_id, quantity, unit_price, subtotal)
  select v_order_id, product_id, quantity, unit_price, subtotal
  from quotation_items
  where quotation_id = v_quotation.id;

  -- The order's first step, for the progress tracker and predictions.
  insert into customer_order_status_history (customer_order_id, previous_status, new_status)
  values (v_order_id, 'quotation approved', 'pending payment');

  update quotations set status = 'approved' where id = v_quotation.id;
  update quotation_requests set status = 'approved' where id = v_request.id;

  return v_number;
end;
$$;

revoke execute on function public.approve_quotation(uuid) from public, anon;
grant execute on function public.approve_quotation(uuid) to authenticated;


-- Only sales and admin can change an order's money -----------------------------
-- As in 013, with the container added to the amounts staff can't change.
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
    or new.container_size is distinct from old.container_size
    or new.container_cost is distinct from old.container_cost
    or new.down_payment_amount is distinct from old.down_payment_amount
    or new.customer_id is distinct from old.customer_id
  ) then
    raise exception 'Only sales or admin can confirm payments or change an order''s amounts.';
  end if;

  return new;
end;
$$;


commit;


-- Check -----------------------------------------------------------------------
-- Expect five rows: the three containers (₱80,000, ₱120,000, ₱130,000), then
-- shipping for Hong Kong (₱120,000) and Default (₱150,000).
select 'container' as setting, name, cost from public.container_sizes
union all
select 'shipping', country, shipping_cost from public.market_markups
order by setting, cost;
