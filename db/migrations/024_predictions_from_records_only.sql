-- =============================================================================
-- 024  Predictions learn only from the system's own records
--
-- The adviser (Nov 10): the predictive analytics must learn only from what the
-- system records, not from numbers typed in from DMC staff's experience. The
-- estimates no longer read DMC's starting values, supplier late shares, busy
-- months or sailing days (db/migrations/017), and the Prediction Settings page
-- is gone, so the four tables that held those numbers are removed. The numbers
-- stay on record in the 017 file and in DMC's answers.
--
-- 017's requested ship date on customer orders is kept: the system records it.
--
-- Safe to run more than once. The last query shows dmc_numbers_removed = true.
-- =============================================================================

drop table if exists public.prediction_busy_months;
drop table if exists public.prediction_countries;
drop table if exists public.prediction_suppliers;
drop table if exists public.prediction_settings;


-- Check: dmc_numbers_removed = true.
select
  to_regclass('public.prediction_settings') is null
    and to_regclass('public.prediction_suppliers') is null
    and to_regclass('public.prediction_countries') is null
    and to_regclass('public.prediction_busy_months') is null
    as dmc_numbers_removed;
