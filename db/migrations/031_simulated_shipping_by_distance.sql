-- =============================================================================
-- 031: Simulated shipping costs by distance
--
-- Each quotation pays one fixed shipping cost for its destination country (set
-- on Markups & Credit), whatever the container. Until now every country but Hong
-- Kong used Default's ₱150,000, so shipping to Iceland cost the same as to Macau.
-- Until DMC gives real amounts, each country's simulated shipping cost is worked
-- out like its simulated markup (030): Hong Kong's ₱120,000, plus ₱10,000 for
-- every 2,000 km farther from Manila than Hong Kong (rounded):
--   Hong Kong, Macau, Taiwan                        ₱120,000
--   Guam, Japan                                     ₱130,000
--   Australia, New Zealand                          ₱150,000
--   Cyprus                                          ₱160,000
--   Malta, Canada, Iceland, United Kingdom          ₱170,000
-- Default (any country not listed) stays ₱150,000.
--
-- Only rows still marked simulated change: a country whose rates someone saved
-- on Markups & Credit (DMC's own) is left as it is. The rows stay marked
-- simulated: the rule that clears the mark when someone saves a row (030) is
-- paused while this changes them, then switched back on. Only quotations made
-- after this use the new amounts. Needs 030. Safe to run more than once.
-- =============================================================================

alter table public.market_markups disable trigger market_markups_saved;

update public.market_markups m
set shipping_cost = v.shipping_cost
from (values
  ('Macau', 120000),
  ('Taiwan', 120000),
  ('Guam', 130000),
  ('Japan', 130000),
  ('Australia', 150000),
  ('New Zealand', 150000),
  ('Cyprus', 160000),
  ('Malta', 170000),
  ('Canada', 170000),
  ('Iceland', 170000),
  ('United Kingdom', 170000)
) as v(country, shipping_cost)
where lower(trim(m.country)) = lower(trim(v.country))
  and m.is_simulated;

alter table public.market_markups enable trigger market_markups_saved;


-- Check: every country's rates (expect 13 rows, all simulated unless saved by
-- hand), and that the "saved by staff" rule is back on (expect true).
select country, markup_percent, shipping_cost, is_simulated,
  (select tgenabled <> 'D' from pg_trigger
   where tgname = 'market_markups_saved' and tgrelid = 'public.market_markups'::regclass) as saving_rule_on
from public.market_markups
order by shipping_cost, markup_percent, country;
