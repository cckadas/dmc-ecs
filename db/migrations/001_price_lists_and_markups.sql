-- =============================================================================
-- 001 — Supplier price lists and selling markups
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm). Safe to re-run.
--
-- supplier_price_list  each supplier's buying price (and minimum order
--                      quantity) per product, imported from the supplier's
--                      price list. Auto-fills purchase-order prices.
-- market_markups       DMC's selling markup by destination country, with a
--                      'Default' row. Auto-fills quotation (PFI) prices.
--
-- Prices are never overwritten: a new price list closes the old price with
-- effective_to, so past orders keep the price they were made at.
--
-- Buying prices and markups reveal DMC's margins, so customers can't read
-- either table. NOTE: these policies check profiles.role, and profiles has
-- row-level security switched off — until that is fixed, anyone can change
-- their own role, which weakens every role check in the system.
-- =============================================================================


-- Supplier price list ---------------------------------------------------------
create table if not exists public.supplier_price_list (
  id              uuid primary key default gen_random_uuid(),
  supplier_id     uuid not null references public.suppliers (id) on delete cascade,
  product_id      uuid not null references public.products (id) on delete cascade,
  unit_price      numeric(12, 2) not null check (unit_price > 0),
  min_order_qty   integer check (min_order_qty is null or min_order_qty > 0),
  effective_from  date not null default current_date,
  effective_to    date,
  updated_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint supplier_price_list_dates_check
    check (effective_to is null or effective_to >= effective_from)
);

-- One current price per supplier and product.
create unique index if not exists supplier_price_list_one_current
  on public.supplier_price_list (supplier_id, product_id)
  where effective_to is null;


-- Selling markups by destination country --------------------------------------
create table if not exists public.market_markups (
  country         text primary key,
  markup_percent  numeric(5, 2) not null check (markup_percent >= 0),
  updated_by      uuid references public.profiles (id) on delete set null,
  updated_at      timestamptz not null default now()
);

-- PLACEHOLDER rates until DMC confirms the real ones.
insert into public.market_markups (country, markup_percent) values
  ('Default', 20),
  ('Hong Kong', 25)
on conflict (country) do nothing;


-- Row-level security ----------------------------------------------------------
alter table public.supplier_price_list enable row level security;
alter table public.market_markups enable row level security;

drop policy if exists "price list readable by staff" on public.supplier_price_list;
create policy "price list readable by staff" on public.supplier_price_list
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'sales', 'procurement', 'management')
  ));

drop policy if exists "price list maintained by admin and procurement" on public.supplier_price_list;
create policy "price list maintained by admin and procurement" on public.supplier_price_list
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'procurement')
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'procurement')
  ));

drop policy if exists "markups readable by staff" on public.market_markups;
create policy "markups readable by staff" on public.market_markups
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'sales', 'management')
  ));

drop policy if exists "markups maintained by admin and management" on public.market_markups;
create policy "markups maintained by admin and management" on public.market_markups
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'management')
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'management')
  ));


-- Atomic price-list import ----------------------------------------------------
-- Imports one supplier's price list in a single transaction: every row lands
-- or none do. Runs with the caller's permissions (security invoker), so the
-- policies above still decide who may import.
create or replace function public.import_supplier_price_list(
  p_supplier_id     uuid,
  p_effective_from  date,
  p_rows            jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row         jsonb;
  v_product_id  uuid;
  v_price       numeric;
  v_moq         integer;
  v_current     public.supplier_price_list%rowtype;
  v_added       integer := 0;
  v_updated     integer := 0;
  v_unchanged   integer := 0;
begin
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_product_id := (v_row ->> 'product_id')::uuid;
    v_price      := (v_row ->> 'unit_price')::numeric;
    v_moq        := nullif(v_row ->> 'min_order_qty', '')::integer;

    -- Each product has one owner; a supplier can only price its own products.
    if not exists (
      select 1 from public.products
      where id = v_product_id and supplier_id = p_supplier_id
    ) then
      raise exception 'Product % is not supplied by this supplier.', v_product_id;
    end if;

    select * into v_current
    from public.supplier_price_list
    where supplier_id = p_supplier_id
      and product_id = v_product_id
      and effective_to is null;

    if found
       and v_current.unit_price = v_price
       and v_current.min_order_qty is not distinct from v_moq then
      v_unchanged := v_unchanged + 1;

    elsif found and v_current.effective_from >= p_effective_from then
      -- Re-imported the same day: correct the price in place.
      update public.supplier_price_list
      set unit_price = v_price, min_order_qty = v_moq, updated_by = auth.uid()
      where id = v_current.id;
      v_updated := v_updated + 1;

    else
      if found then
        update public.supplier_price_list
        set effective_to = p_effective_from - 1
        where id = v_current.id;
      end if;

      insert into public.supplier_price_list
        (supplier_id, product_id, unit_price, min_order_qty, effective_from, updated_by)
      values
        (p_supplier_id, v_product_id, v_price, v_moq, p_effective_from, auth.uid());
      v_added := v_added + 1;
    end if;
  end loop;

  return jsonb_build_object('added', v_added, 'updated', v_updated, 'unchanged', v_unchanged);
end;
$$;

revoke execute on function public.import_supplier_price_list(uuid, date, jsonb) from public, anon;
grant execute on function public.import_supplier_price_list(uuid, date, jsonb) to authenticated;
