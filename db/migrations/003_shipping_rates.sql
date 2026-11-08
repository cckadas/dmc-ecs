-- =============================================================================
-- 003 — Fixed shipping rates by destination country
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm), after 001.
-- Safe to re-run.
--
-- Each country in market_markups also gets a shipping rate per unit ordered.
-- A quotation's shipping = that rate x the total units ordered, using the
-- Default row for countries without their own. Sales can't type it, so it
-- can't be entered wrong by accident or on purpose. Set by admin and
-- management (the existing market_markups policies cover the new column).
-- =============================================================================

alter table public.market_markups
  add column if not exists shipping_per_unit numeric(12, 2)
    check (shipping_per_unit is null or shipping_per_unit >= 0);

-- PLACEHOLDER rates until DMC confirms the real ones. Only fills rates that
-- are still empty, so re-running never overwrites a rate someone has set.
update public.market_markups set shipping_per_unit = 40
where country = 'Default' and shipping_per_unit is null;

update public.market_markups set shipping_per_unit = 50
where country = 'Hong Kong' and shipping_per_unit is null;


-- Check -----------------------------------------------------------------------
-- Expect: Default 20.00% ₱40.00, Hong Kong 25.00% ₱50.00
-- select country, markup_percent, shipping_per_unit from public.market_markups order by country;
