-- =============================================================================
-- 010 — Every product has its case volume and weight
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm). Safe to re-run.
--
-- DMC checks whether an order fits a container by adding up the volume and
-- weight of every case in it, both from the supplier. So every product needs
-- both, above 0: products.cbm (m³ per case) and products.gross_weight_kg (kg
-- per case, packaging included).
--
-- Checked when a product is added and whenever one is edited. NOT VALID leaves
-- the few old test products without measurements in place (they're all
-- Unavailable, and are removed with the old test data); they can only be
-- edited again once their measurements are filled in.
-- =============================================================================

alter table public.products
  drop constraint if exists products_case_measurements;

-- coalesce, so a missing value (null) fails the check instead of passing it.
alter table public.products
  add constraint products_case_measurements
  check (coalesce(cbm, 0) > 0 and coalesce(gross_weight_kg, 0) > 0)
  not valid;


-- Check -----------------------------------------------------------------------
-- Expect 6: the old test products, until the old test data is cleared.
-- select count(*) as products_without_measurements
-- from public.products
-- where coalesce(cbm, 0) <= 0 or coalesce(gross_weight_kg, 0) <= 0;
