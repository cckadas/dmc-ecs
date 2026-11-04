-- =============================================================================
-- 017 — Starting values for the predictions, and each order's requested date
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm), after 016.
-- Safe to re-run. All or nothing: if any line fails, nothing is changed.
--
-- The predictions learn from finished orders. While those are few, they lean on
-- DMC staff's usual times, from experience rather than records. Admin or
-- management enters them on the Prediction settings page:
--   prediction_settings     each step's usual days, and the default for suppliers
--   prediction_suppliers    each supplier's usual days, how often late, by how much
--   prediction_countries    sailing days to each country, and extra labeling days
--   prediction_busy_months  extra days for suppliers in DMC's busy months
-- Rows marked is_placeholder are stand-ins until DMC gives its own numbers.
--
-- The customer's requested ship date is also copied onto each order, so the
-- staff who can't read quotation requests (management) can compare it with the
-- estimate.
-- =============================================================================

begin;


-- Each step's usual days ------------------------------------------------------
create table if not exists public.prediction_settings (
  key             text primary key,
  days            numeric(6, 1) not null check (days >= 0),
  is_placeholder  boolean not null default true,
  updated_by      uuid references public.profiles (id) on delete set null,
  updated_at      timestamptz not null default now()
);

-- PLACEHOLDERS until DMC gives its own. Never overwrites a value someone saved.
insert into public.prediction_settings (key, days)
values
  ('payment_check', 1),
  ('ordering', 2),
  ('supplier_lead', 14),
  ('labeling', 5),
  ('shipping', 4),
  ('labeling_per_1000_cases', 0)
on conflict (key) do nothing;


-- Each supplier's usual times, as DMC staff know them -------------------------
-- No row for a supplier = no number from DMC yet; supplier_lead is used instead.
create table if not exists public.prediction_suppliers (
  supplier_id      uuid primary key references public.suppliers (id) on delete cascade,
  usual_lead_days  numeric(6, 1) check (usual_lead_days is null or usual_lead_days > 0),
  late_frequency   text check (late_frequency is null or late_frequency in ('rarely', 'sometimes', 'often')),
  usual_late_days  numeric(6, 1) check (usual_late_days is null or usual_late_days >= 0),
  updated_by       uuid references public.profiles (id) on delete set null,
  updated_at       timestamptz not null default now()
);


-- Sailing days to each country, and extra labeling days there -----------------
-- A country without its own row uses the Default row.
create table if not exists public.prediction_countries (
  country              text primary key,
  sailing_days         numeric(6, 1) check (sailing_days is null or sailing_days > 0),
  extra_labeling_days  numeric(6, 1) not null default 0 check (extra_labeling_days >= 0),
  is_placeholder       boolean not null default true,
  updated_by           uuid references public.profiles (id) on delete set null,
  updated_at           timestamptz not null default now()
);

-- A PLACEHOLDER sailing time for every country until DMC gives real ones.
insert into public.prediction_countries (country, sailing_days)
values ('Default', 7)
on conflict (country) do nothing;


-- Extra days in DMC's busy months ---------------------------------------------
create table if not exists public.prediction_busy_months (
  month       smallint primary key check (month between 1 and 12),
  extra_days  numeric(6, 1) not null default 0 check (extra_days >= 0),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);

insert into public.prediction_busy_months (month)
select generate_series(1, 12)
on conflict (month) do nothing;


-- Who can see and change them --------------------------------------------------
-- Staff read them for the estimates on their pages. Customers don't: their
-- estimates are worked out on DMC's server. Admin and management maintain them.
alter table public.prediction_settings enable row level security;
alter table public.prediction_suppliers enable row level security;
alter table public.prediction_countries enable row level security;
alter table public.prediction_busy_months enable row level security;

drop policy if exists "staff: read prediction settings" on public.prediction_settings;
create policy "staff: read prediction settings" on public.prediction_settings
  for select to authenticated
  using ((select public.has_role('admin', 'sales', 'procurement', 'warehouse', 'management')));

drop policy if exists "admin and management: maintain prediction settings" on public.prediction_settings;
create policy "admin and management: maintain prediction settings" on public.prediction_settings
  for all to authenticated
  using ((select public.has_role('admin', 'management')))
  with check ((select public.has_role('admin', 'management')));

drop policy if exists "staff: read prediction suppliers" on public.prediction_suppliers;
create policy "staff: read prediction suppliers" on public.prediction_suppliers
  for select to authenticated
  using ((select public.has_role('admin', 'sales', 'procurement', 'warehouse', 'management')));

drop policy if exists "admin and management: maintain prediction suppliers" on public.prediction_suppliers;
create policy "admin and management: maintain prediction suppliers" on public.prediction_suppliers
  for all to authenticated
  using ((select public.has_role('admin', 'management')))
  with check ((select public.has_role('admin', 'management')));

drop policy if exists "staff: read prediction countries" on public.prediction_countries;
create policy "staff: read prediction countries" on public.prediction_countries
  for select to authenticated
  using ((select public.has_role('admin', 'sales', 'procurement', 'warehouse', 'management')));

drop policy if exists "admin and management: maintain prediction countries" on public.prediction_countries;
create policy "admin and management: maintain prediction countries" on public.prediction_countries
  for all to authenticated
  using ((select public.has_role('admin', 'management')))
  with check ((select public.has_role('admin', 'management')));

drop policy if exists "staff: read prediction busy months" on public.prediction_busy_months;
create policy "staff: read prediction busy months" on public.prediction_busy_months
  for select to authenticated
  using ((select public.has_role('admin', 'sales', 'procurement', 'warehouse', 'management')));

drop policy if exists "admin and management: maintain prediction busy months" on public.prediction_busy_months;
create policy "admin and management: maintain prediction busy months" on public.prediction_busy_months
  for all to authenticated
  using ((select public.has_role('admin', 'management')))
  with check ((select public.has_role('admin', 'management')));


-- Each order's requested ship date --------------------------------------------
alter table public.customer_orders
  add column if not exists requested_ship_date date;

-- Orders so far: from their quotation request.
update public.customer_orders o
set requested_ship_date = r.preferred_ship_date
from public.quotations q
join public.quotation_requests r on r.id = q.quotation_request_id
where q.id = o.quotation_id
  and o.requested_ship_date is null
  and r.preferred_ship_date is not null;

-- New orders: copied when the order is created from its quotation.
create or replace function public.set_order_requested_ship_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.requested_ship_date is null and new.quotation_id is not null then
    select r.preferred_ship_date into new.requested_ship_date
    from quotations q
    join quotation_requests r on r.id = q.quotation_request_id
    where q.id = new.quotation_id;
  end if;

  return new;
end;
$$;

drop trigger if exists customer_orders_requested_ship_date on public.customer_orders;
create trigger customer_orders_requested_ship_date
  before insert on public.customer_orders
  for each row execute function public.set_order_requested_ship_date();


commit;


-- Check -----------------------------------------------------------------------
-- Expect 7 placeholder rows (6 steps and the Default sailing time), 0 busy months
-- with extra days yet, and how many orders now carry a requested ship date.
select 'starting value' as kind, key as name, days as value, is_placeholder from public.prediction_settings
union all
select 'sailing days', country, sailing_days, is_placeholder from public.prediction_countries
union all
select 'busy months with extra days', 'all months', count(*) filter (where extra_days > 0), null from public.prediction_busy_months
union all
select 'orders with a requested ship date', 'all orders', count(requested_ship_date), null from public.customer_orders
order by kind, name;
