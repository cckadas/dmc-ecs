-- =============================================================================
-- 011 — Past quotations are kept, and documents are numbered in sequence
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm). Safe to re-run.
-- All or nothing: if any line fails, nothing is changed.
--
-- DMC keeps its past records. Approving a quotation used to delete the quotation
-- and its request; now both are kept, marked approved, and the order points back
-- to its quotation.
--
-- Approving and rejecting now happen in one database step instead of many
-- separate calls from the browser, so:
--   - an order is either created completely or not at all,
--   - its amounts are copied from the quotation here, never sent by the browser,
--   - two customers approving at the same moment can't get the same order number.
--
-- Quotations, orders and purchase orders are numbered in sequence per year
-- (QT-2026-00001, ORD-2026-00001, PO-2026-00001). Existing numbers are unchanged;
-- each sequence continues after the highest one already used.
-- =============================================================================

begin;


-- Who is asking ---------------------------------------------------------------
-- The signed-in user's role, or null for a deactivated account. Used by the rules
-- here and in 012–014. Runs with the owner's rights, so it can read profiles
-- without going through the rules on profiles.
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(trim(role))
  from profiles
  where id = auth.uid()
    and coalesce(is_active, true)
$$;

revoke execute on function public.my_role() from public, anon;
grant execute on function public.my_role() to authenticated;

create or replace function public.has_role(variadic p_roles text[])
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(public.my_role() = any(p_roles), false)
$$;

revoke execute on function public.has_role(text[]) from public, anon;
grant execute on function public.has_role(text[]) to authenticated;


-- Numbers in sequence ---------------------------------------------------------
create table if not exists public.document_counters (
  prefix       text    not null,
  year         integer not null,
  last_number  integer not null default 0,
  primary key (prefix, year)
);

-- No rules on purpose: only the functions below can touch it.
alter table public.document_counters enable row level security;

-- Each sequence continues after the highest number already used.
insert into public.document_counters (prefix, year, last_number)
select 'ORD', m[1]::integer, max(m[2]::integer)
from public.customer_orders
cross join lateral regexp_match(order_number, '^ORD-(\d{4})-(\d+)$') as m
where m is not null
group by m[1]::integer
on conflict (prefix, year) do update
  set last_number = greatest(public.document_counters.last_number, excluded.last_number);

insert into public.document_counters (prefix, year, last_number)
select 'PO', m[1]::integer, max(m[2]::integer)
from public.purchase_orders
cross join lateral regexp_match(po_number, '^PO-(\d{4})-(\d+)$') as m
where m is not null
group by m[1]::integer
on conflict (prefix, year) do update
  set last_number = greatest(public.document_counters.last_number, excluded.last_number);

insert into public.document_counters (prefix, year, last_number)
select 'QT', m[1]::integer, max(m[2]::integer)
from public.quotations
cross join lateral regexp_match(quotation_number, '^QT-(\d{4})-(\d+)$') as m
where m is not null
group by m[1]::integer
on conflict (prefix, year) do update
  set last_number = greatest(public.document_counters.last_number, excluded.last_number);

-- Taking a number locks that sequence's row until the transaction ends, so two
-- people at the same moment still get different numbers. The year is Philippine
-- time.
create or replace function public.next_document_number(p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year    integer := extract(year from (now() at time zone 'Asia/Manila'))::integer;
  v_number  integer;
begin
  insert into document_counters (prefix, year, last_number)
  values (p_prefix, v_year, 1)
  on conflict (prefix, year) do update
    set last_number = document_counters.last_number + 1
  returning last_number into v_number;

  return format('%s-%s-%s', p_prefix, v_year, lpad(v_number::text, 5, '0'));
end;
$$;

revoke execute on function public.next_document_number(text) from public, anon, authenticated;

-- The database gives each new quotation and PO its number, ignoring anything sent.
create or replace function public.assign_quotation_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.quotation_number := next_document_number('QT');
  return new;
end;
$$;

drop trigger if exists quotations_number on public.quotations;
create trigger quotations_number
  before insert on public.quotations
  for each row execute function public.assign_quotation_number();

create or replace function public.assign_purchase_order_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.po_number := next_document_number('PO');
  return new;
end;
$$;

drop trigger if exists purchase_orders_number on public.purchase_orders;
create trigger purchase_orders_number
  before insert on public.purchase_orders
  for each row execute function public.assign_purchase_order_number();

-- Only for Settings' "delete all order data", so a cleared system starts again
-- from 00001.
create or replace function public.reset_document_counters()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Only an administrator can reset document numbers.';
  end if;

  delete from document_counters where true;
end;
$$;

revoke execute on function public.reset_document_counters() from public, anon;
grant execute on function public.reset_document_counters() to authenticated;


-- An order remembers its quotation --------------------------------------------
alter table public.customer_orders
  add column if not exists quotation_id uuid;

alter table public.customer_orders
  drop constraint if exists customer_orders_quotation_id_fkey;

alter table public.customer_orders
  add constraint customer_orders_quotation_id_fkey
  foreign key (quotation_id) references public.quotations(id) on delete set null;

-- One order per quotation, even if approve is pressed twice.
create unique index if not exists customer_orders_quotation_id_key
  on public.customer_orders (quotation_id);


-- Approve a quotation ---------------------------------------------------------
-- Everything happens or nothing does. The credit-limit trigger on customer_orders
-- still applies and refuses the order if the customer has reached their limit.
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
    total_amount, down_payment_amount, delivery_location_id, pfi_file_path, expiry_date, status
  )
  values (
    v_number, v_request.customer_id, v_quotation.id, v_quotation.quotation_number,
    v_quotation.subtotal, v_quotation.shipping_cost, v_quotation.total_amount,
    v_quotation.down_payment_amount, v_request.delivery_location_id,
    v_quotation.pfi_file_path, v_quotation.expiry_date, 'pending payment'
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


-- Reject a quotation ----------------------------------------------------------
create or replace function public.reject_quotation(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quotation  quotations%rowtype;
  v_request    quotation_requests%rowtype;
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

  update quotations set status = 'rejected' where id = v_quotation.id;
  update quotation_requests set status = 'rejected' where id = v_request.id;
end;
$$;

revoke execute on function public.reject_quotation(uuid) from public, anon;
grant execute on function public.reject_quotation(uuid) to authenticated;


-- A deleted order's quotation stays on record ---------------------------------
-- Sales can delete an order whose payment was rejected. Its quotation is kept and
-- marked cancelled, so it doesn't look like it led to a live order.
create or replace function public.cancel_quotation_of_deleted_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  if old.quotation_id is not null then
    update quotations set status = 'cancelled' where id = old.quotation_id
    returning quotation_request_id into v_request_id;

    update quotation_requests set status = 'cancelled' where id = v_request_id;
  end if;

  return old;
end;
$$;

drop trigger if exists customer_orders_cancel_quotation on public.customer_orders;
create trigger customer_orders_cancel_quotation
  after delete on public.customer_orders
  for each row execute function public.cancel_quotation_of_deleted_order();


-- Old delivery addresses ------------------------------------------------------
-- Past requests and orders keep pointing at the address they used, so an address
-- in use is archived: hidden from the customer's list and from new requests, but
-- still shown on past records. An unused address is really deleted.
alter table public.delivery_locations
  add column if not exists is_archived boolean not null default false;

create or replace function public.remove_delivery_location(p_location_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select profile_id into v_owner from delivery_locations where id = p_location_id;

  if v_owner is null or v_owner is distinct from auth.uid() then
    raise exception 'This delivery location no longer exists.';
  end if;

  if exists (select 1 from quotation_requests where delivery_location_id = p_location_id)
     or exists (select 1 from customer_orders where delivery_location_id = p_location_id) then
    update delivery_locations set is_archived = true where id = p_location_id;
    return 'archived';
  end if;

  delete from delivery_locations where id = p_location_id;
  return 'deleted';
end;
$$;

revoke execute on function public.remove_delivery_location(uuid) from public, anon;
grant execute on function public.remove_delivery_location(uuid) to authenticated;

commit;


-- Check -----------------------------------------------------------------------
-- Expect the sequences to continue after the numbers already used.
select prefix, year, last_number from public.document_counters order by prefix, year;
