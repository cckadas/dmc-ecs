-- =============================================================================
-- 006 — Unavailable products can't be put in new quotation requests
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm). Safe to re-run.
--
-- A product marked Unavailable (products.availability, set by admin) can't be
-- added to a NEW quotation request. Only new request lines are checked, so
-- requests, quotations, orders and purchase orders already in progress carry
-- on unchanged when a product becomes unavailable later.
-- =============================================================================

create or replace function public.enforce_product_available()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name          text;
  v_availability  text;
begin
  select product_name, availability
    into v_name, v_availability
  from products
  where id = new.product_id;

  if lower(coalesce(v_availability, 'available')) = 'unavailable' then
    raise exception '% is currently unavailable and can''t be requested.', v_name;
  end if;

  return new;
end;
$$;

-- INSERT only: lines already saved are never re-checked.
drop trigger if exists quotation_request_items_product_available on public.quotation_request_items;
create trigger quotation_request_items_product_available
  before insert on public.quotation_request_items
  for each row execute function public.enforce_product_available();


-- Check -----------------------------------------------------------------------
-- Expect one row.
-- select tgname from pg_trigger where tgname = 'quotation_request_items_product_available';
