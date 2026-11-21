-- =============================================================================
-- 007 — Product families, pack sizes, CBM and weights
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm). Safe to re-run.
--
-- Each pack size of a product stays its own product (its own price, MOQ,
-- weight and CBM). Sizes of the same product share a family name so the
-- catalog and the request form show them together, e.g. "Argentina Corned
-- Beef" in 150g x 48 and 260g x 48.
--
-- cbm / net_weight_kg / gross_weight_kg are per case (the unit ordered), as
-- DMC's PFIs show them. They are stored now, ready for the PFI.
-- =============================================================================

alter table public.products
  add column if not exists family           text,
  add column if not exists pack_size        text,
  add column if not exists cbm              numeric(10, 4) check (cbm is null or cbm >= 0),
  add column if not exists net_weight_kg    numeric(10, 3) check (net_weight_kg is null or net_weight_kg >= 0),
  add column if not exists gross_weight_kg  numeric(10, 3) check (gross_weight_kg is null or gross_weight_kg >= 0);

create index if not exists products_family_idx on public.products (lower(family));


-- Check -----------------------------------------------------------------------
-- Expect the five new columns.
-- select column_name from information_schema.columns
--   where table_name = 'products' and column_name in ('family', 'pack_size', 'cbm', 'net_weight_kg', 'gross_weight_kg');
