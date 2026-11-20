-- =============================================================================
-- 036: A delivery location in use is frozen
--
-- Requests and orders don't keep their own copy of the address: they point at
-- one of the customer's saved delivery locations. Until now a customer could
-- edit any saved location at any time, country included, and every request
-- and order using it changed with it: ongoing ones (still priced, labeled and
-- estimated for the old country) and finished ones (whose records the
-- predictions learn from).
--
-- Now a location that any quotation request or order uses can't be changed.
-- To change an address, the customer saves a new location (the Delivery
-- Locations page does this for them) and can take the old one off their list
-- (archiving it, as 011 does); requests and orders keep the address they were
-- made with. Unused locations can be edited as before.
--
-- Changing where an ongoing order goes is a separate step, waiting for DMC's
-- rule. The server and the SQL editor (no signed-in user) aren't held to this,
-- for corrections. Safe to run more than once. The last query shows
-- frozen_when_used = true and how many saved locations are in use.
-- =============================================================================


create or replace function public.freeze_used_delivery_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used text;
begin
  if auth.uid() is null then
    return new;
  end if;

  -- Archiving (taking it off the customer's list) is fine; nothing else on it
  -- may change once it's used.
  if (to_jsonb(new) - 'is_archived') = (to_jsonb(old) - 'is_archived') then
    return new;
  end if;

  select string_agg(reference, ', ' order by made_at desc)
    into v_used
  from (
    select o.order_number as reference, o.created_at as made_at
    from customer_orders o
    where o.delivery_location_id = old.id
    union all
    select r.quotation_reference, r.created_at
    from quotation_requests r
    where r.delivery_location_id = old.id
    order by made_at desc
    limit 4
  ) used;

  if v_used is not null then
    raise exception 'This delivery location is on your requests or orders (%), so it can''t be changed: they keep the address they were made with. Save the new address as a new location instead.', v_used;
  end if;

  return new;
end;
$$;

revoke execute on function public.freeze_used_delivery_location() from public, anon, authenticated;

drop trigger if exists delivery_locations_frozen_when_used on public.delivery_locations;
create trigger delivery_locations_frozen_when_used
  before update on public.delivery_locations
  for each row execute function public.freeze_used_delivery_location();


-- Check: frozen_when_used = true, and how many saved locations are in use now.
select
  exists (select 1 from pg_trigger where tgname = 'delivery_locations_frozen_when_used') as frozen_when_used,
  (select count(*) from public.delivery_locations l
   where exists (select 1 from public.customer_orders o where o.delivery_location_id = l.id)
      or exists (select 1 from public.quotation_requests r where r.delivery_location_id = l.id)) as locations_in_use;
