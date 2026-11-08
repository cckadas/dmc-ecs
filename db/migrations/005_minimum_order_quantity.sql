-- =============================================================================
-- 005 — Customers order at least the supplier's minimum order quantity
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm), after 001.
-- Safe to re-run.
--
-- Each product's minimum order quantity (MOQ) is the one its supplier's
-- current price list gives (supplier_price_list.min_order_qty, set by
-- procurement in Price Lists). Customers see it on every product and can't
-- request less; a product with no MOQ on file has no minimum.
--
-- product_minimum_order_quantities()  the MOQ per product, for every signed-in
--                                     user. Customers can't read the price
--                                     list itself (it holds DMC's buying
--                                     prices), so this returns the MOQ only.
-- enforce_minimum_order_quantity      refuses a quotation request line below
--                                     the MOQ, even if a screen's check is
--                                     skipped.
-- =============================================================================


-- MOQ per product, without prices ---------------------------------------------
create or replace function public.product_minimum_order_quantities()
returns table (product_id uuid, min_order_qty integer)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, spl.min_order_qty
  from products p
  join supplier_price_list spl
    on spl.product_id = p.id
   and spl.supplier_id = p.supplier_id
   and spl.effective_to is null
  where spl.min_order_qty is not null
$$;

revoke execute on function public.product_minimum_order_quantities() from public, anon;
grant execute on function public.product_minimum_order_quantities() to authenticated;


-- Enforcement -----------------------------------------------------------------
create or replace function public.enforce_minimum_order_quantity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moq   integer;
  v_name  text;
  v_unit  text;
begin
  select spl.min_order_qty, p.product_name, p.unit
    into v_moq, v_name, v_unit
  from products p
  join supplier_price_list spl
    on spl.product_id = p.id
   and spl.supplier_id = p.supplier_id
   and spl.effective_to is null
  where p.id = new.product_id;

  if v_moq is not null and new.quantity < v_moq then
    raise exception '% has a minimum order of % %.', v_name, v_moq, coalesce(v_unit, 'units');
  end if;

  return new;
end;
$$;

drop trigger if exists quotation_request_items_minimum_order on public.quotation_request_items;
create trigger quotation_request_items_minimum_order
  before insert or update of quantity, product_id on public.quotation_request_items
  for each row execute function public.enforce_minimum_order_quantity();


-- Check -----------------------------------------------------------------------
-- Expect one row per product that has an MOQ in Price Lists.
-- select * from public.product_minimum_order_quantities();
