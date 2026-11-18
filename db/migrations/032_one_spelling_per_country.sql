-- =============================================================================
-- 032: One country, one spelling
--
-- A quotation finds its markup and shipping cost by the delivery location's
-- country, spelled as on Markups & Credit (spaces and capitals aside). Both were
-- typed freely, so "Hongkong" could be added on Markups & Credit as a second
-- country next to "Hong Kong", and a delivery location spelled differently from
-- its markup row paid Default's rates instead of its country's.
--
-- The screens now pick countries from a list (client/src/utils/countryPlaces.js).
-- This script makes the database hold to it too, whatever saves the row:
--   - Markups & Credit can't have two rows for the same country spelled
--     differently ("Hong Kong", "Hongkong", "HONG-KONG": only letters count).
--   - A delivery location's country is tidied (extra spaces) and written the way
--     its markup row writes it, so it always finds its own rates.
-- Delivery locations already saved are tidied the same way.
--
-- Stops, changing nothing, if Markups & Credit already has the same country
-- twice: delete the extra row there first. Safe to run more than once.
-- =============================================================================

do $$
declare
  v_twice text;
begin
  select string_agg(names, '; ') into v_twice
  from (
    select string_agg(country, ' and ' order by country) as names
    from public.market_markups
    group by regexp_replace(lower(country), '[^a-z]', '', 'g')
    having count(*) > 1
  ) as same_country;

  if v_twice is not null then
    raise exception 'Markups & Credit has the same country spelled differently: %. Delete the extra row there, then run this again.', v_twice;
  end if;
end;
$$;


-- One row per country on Markups & Credit -----------------------------------------
create unique index if not exists market_markups_one_row_per_country
  on public.market_markups ((regexp_replace(lower(country), '[^a-z]', '', 'g')));


-- A delivery location's country, written as its markup row writes it -------------
create or replace function public.tidy_delivery_country()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_written text;
begin
  new.country := trim(regexp_replace(coalesce(new.country, ''), '\s+', ' ', 'g'));

  select m.country into v_written
  from market_markups m
  where lower(trim(m.country)) <> 'default'
    and regexp_replace(lower(m.country), '[^a-z]', '', 'g') = regexp_replace(lower(new.country), '[^a-z]', '', 'g')
  limit 1;

  if v_written is not null then
    new.country := v_written;
  end if;

  return new;
end;
$$;

revoke execute on function public.tidy_delivery_country() from public, anon, authenticated;

drop trigger if exists delivery_locations_tidy_country on public.delivery_locations;
create trigger delivery_locations_tidy_country
  before insert or update of country on public.delivery_locations
  for each row execute function public.tidy_delivery_country();


-- The delivery locations already saved: only those that would change ------------
update public.delivery_locations l
set country = l.country
where l.country is distinct from trim(regexp_replace(coalesce(l.country, ''), '\s+', ' ', 'g'))
   or exists (
     select 1 from public.market_markups m
     where lower(trim(m.country)) <> 'default'
       and regexp_replace(lower(m.country), '[^a-z]', '', 'g') = regexp_replace(lower(l.country), '[^a-z]', '', 'g')
       and m.country is distinct from l.country
   );


-- Check: the rule and the tidying are in place (expect true, true), and every
-- delivery location's country with how many use it and whether it has its own
-- rates ("own rates" or "uses Default").
select
  to_regclass('public.market_markups_one_row_per_country') is not null as one_row_per_country,
  exists (
    select 1 from pg_trigger
    where tgname = 'delivery_locations_tidy_country' and tgrelid = 'public.delivery_locations'::regclass
  ) as delivery_countries_tidied,
  (
    select string_agg(format('%s x%s (%s)', country, uses, rates), ', ' order by country)
    from (
      select l.country, count(*) as uses,
        case when exists (select 1 from public.market_markups m where lower(trim(m.country)) = lower(trim(l.country)))
          then 'own rates' else 'uses Default' end as rates
      from public.delivery_locations l
      group by l.country
    ) as countries
  ) as delivery_countries;
