-- =============================================================================
-- 030: Simulated markups for every country DMC ships to
--
-- Until now only Hong Kong had its own markup; every other country fell back to
-- Default (20%) without anyone noticing. Until DMC gives its own numbers, each
-- of DMC's countries gets a simulated markup worked out from Hong Kong's 25%:
-- the farther the country is from Manila, the higher the markup, by 1 point for
-- every 2,000 km farther than Hong Kong (rounded), so 25% to 30%:
--   Hong Kong 1,114 km, Macau 1,151, Taiwan 895       -> 25%
--   Guam 2,558, Japan 2,974                           -> 26%
--   Australia 6,268, New Zealand 8,024                -> 28%
--   Cyprus 8,905                                      -> 29%
--   Malta 10,482, Canada 10,548, Iceland 10,708,
--   United Kingdom 10,734                             -> 30%
-- (distances from Manila to each country's main port or city, as in
-- client/src/utils/countryPlaces.js). Shipping costs are not simulated: each new
-- country starts with Default's shipping cost, as it was using until now.
--
-- These rates, and the old placeholders for Default and Hong Kong, are marked
-- simulated, and Markups & Credit says so. When someone saves a country's rates
-- there, they become DMC's own and the mark goes.
--
-- Only quotations made after this use the new markups; quotations and orders
-- made before keep their prices. A country that already has its own rates is
-- left as it is. Safe to run more than once.
-- =============================================================================

alter table public.market_markups
  add column if not exists is_simulated boolean not null default false;


-- Saving a country's rates on Markups & Credit makes them DMC's own -------------
create or replace function public.markup_saved_by_staff()
returns trigger
language plpgsql
as $$
begin
  new.is_simulated := false;
  return new;
end;
$$;

drop trigger if exists market_markups_saved on public.market_markups;
create trigger market_markups_saved
  before update of markup_percent, shipping_cost on public.market_markups
  for each row execute function public.markup_saved_by_staff();


-- The old placeholders (001, 016) are simulated too, if they're still as set ----
update public.market_markups
set is_simulated = true
where (lower(trim(country)) = 'default' and markup_percent = 20 and shipping_cost = 150000)
   or (lower(trim(country)) = 'hong kong' and markup_percent = 25 and shipping_cost = 120000);


-- Each of DMC's other countries, with Default's shipping cost ---------------------
insert into public.market_markups (country, markup_percent, shipping_cost, is_simulated)
select v.country, v.markup_percent, d.shipping_cost, true
from (values
  ('Macau', 25),
  ('Taiwan', 25),
  ('Guam', 26),
  ('Japan', 26),
  ('Australia', 28),
  ('New Zealand', 28),
  ('Cyprus', 29),
  ('Malta', 30),
  ('Canada', 30),
  ('Iceland', 30),
  ('United Kingdom', 30)
) as v(country, markup_percent)
cross join (
  select shipping_cost from public.market_markups where lower(trim(country)) = 'default'
) as d
where not exists (
  select 1 from public.market_markups m where lower(trim(m.country)) = lower(trim(v.country))
);


-- Check: every country's rates, and whether they're simulated (expect 13 rows).
select country, markup_percent, shipping_cost, is_simulated
from public.market_markups
order by markup_percent, country;
