-- =============================================================================
-- 008 — A purchase order's price is always the supplier's price-list price
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm), after 001.
-- Safe to re-run.
--
-- The price on a PO line can't be typed: it must equal the supplier's current
-- price in Price Lists. A new supplier price goes through Price Lists, which
-- keeps the old one as dated history. The database refuses any other price,
-- even if a screen's check is skipped. Lines already saved are only
-- re-checked if their price, product or supplier is changed.
-- =============================================================================

create or replace function public.enforce_po_price_list()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price  numeric;
  v_name   text;
begin
  select product_name into v_name from products where id = new.product_id;

  select l.unit_price into v_price
  from supplier_price_list l
  where l.supplier_id = new.supplier_id
    and l.product_id = new.product_id
    and l.effective_to is null;

  if v_price is null then
    raise exception '% has no current supplier price. Add it in Price Lists first.', coalesce(v_name, 'This product');
  end if;

  if new.unit_price is distinct from v_price then
    raise exception 'The price for % must be the supplier''s price-list price of ₱%.',
      coalesce(v_name, 'this product'), to_char(v_price, 'FM999,999,999,990.00');
  end if;

  return new;
end;
$$;

drop trigger if exists purchase_order_items_price_list on public.purchase_order_items;
create trigger purchase_order_items_price_list
  before insert or update of unit_price, product_id, supplier_id on public.purchase_order_items
  for each row execute function public.enforce_po_price_list();


-- Check -----------------------------------------------------------------------
-- Expect one row.
-- select tgname from pg_trigger where tgname = 'purchase_order_items_price_list';
