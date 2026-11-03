-- =============================================================================
-- 015 — A supplier's amounts must match, or come with a reason
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm). Safe to re-run.
-- All or nothing: if any line fails, nothing is changed.
--
-- The panel asked for transaction consistency: documents should validate each
-- other. So for each supplier on a purchase order:
--   - the amount on the supplier's own PFI must equal the PO's total for them, and
--   - what DMC pays must equal the amount on the supplier's PFI,
-- unless staff record why they differ (a discount, a rounding, a partial payment).
-- Differences are kept on the record, not blocked outright, since they can be
-- legitimate. Amounts already saved aren't re-checked.
-- =============================================================================

begin;


alter table public.purchase_order_items
  add column if not exists pfi_difference_reason text,
  add column if not exists payment_difference_reason text;


create or replace function public.enforce_supplier_amounts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_total  numeric;
begin
  if new.supplier_pfi_amount is distinct from old.supplier_pfi_amount then
    select coalesce(sum(ordered_quantity * unit_price), 0) into v_po_total
    from purchase_order_items
    where purchase_order_id = new.purchase_order_id
      and supplier_id = new.supplier_id;

    if round(coalesce(new.supplier_pfi_amount, 0), 2) <> round(v_po_total, 2)
       and coalesce(trim(new.pfi_difference_reason), '') = '' then
      raise exception 'The supplier''s amount of ₱% doesn''t match this PO''s total of ₱% for them. Enter the reason for the difference.',
        to_char(coalesce(new.supplier_pfi_amount, 0), 'FM999,999,999,990.00'),
        to_char(v_po_total, 'FM999,999,999,990.00');
    end if;
  end if;

  if new.payment_amount is distinct from old.payment_amount then
    if round(coalesce(new.payment_amount, 0), 2) <> round(coalesce(new.supplier_pfi_amount, 0), 2)
       and coalesce(trim(new.payment_difference_reason), '') = '' then
      raise exception 'The payment of ₱% doesn''t match the supplier''s amount of ₱%. Enter the reason for the difference.',
        to_char(coalesce(new.payment_amount, 0), 'FM999,999,999,990.00'),
        to_char(coalesce(new.supplier_pfi_amount, 0), 'FM999,999,999,990.00');
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists purchase_order_items_supplier_amounts on public.purchase_order_items;
create trigger purchase_order_items_supplier_amounts
  before update of supplier_pfi_amount, payment_amount on public.purchase_order_items
  for each row execute function public.enforce_supplier_amounts();

commit;


-- Check -----------------------------------------------------------------------
-- Expect one row.
select tgname from pg_trigger where tgname = 'purchase_order_items_supplier_amounts';
