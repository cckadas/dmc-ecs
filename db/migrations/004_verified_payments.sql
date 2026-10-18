-- =============================================================================
-- 004 — Payments count only once sales verifies them
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm), after 002.
-- Safe to re-run.
--
-- The amount a customer types when paying can't be trusted until sales has
-- checked it against the proof. So a submitted payment now waits in
-- pending_payment_amount, and settled_amount (what the customer has paid)
-- only grows when sales approves it. The credit limit (002) uses
-- settled_amount, so an unverified payment no longer lowers a customer's debt.
--
-- Customers can submit a payment, but the database refuses any change by a
-- customer to the amount paid, the order's money fields, or a status other
-- than 'submitted' — even if a screen's own checks are skipped.
-- =============================================================================

alter table public.customer_orders
  add column if not exists pending_payment_amount numeric(14, 2) not null default 0
    check (pending_payment_amount >= 0);

-- First payments still waiting for sales were counted as paid. Move them to
-- pending so they count only once verified.
update public.customer_orders
set pending_payment_amount = settled_amount,
    settled_amount = 0
where status = 'submitted'
  and coalesce(settled_amount, 0) > 0
  and pending_payment_amount = 0;


-- Protect payments from customer edits ----------------------------------------
create or replace function public.protect_order_payments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from profiles p where p.id = auth.uid() and p.role = 'customer'
  ) then
    return new;
  end if;

  if new.settled_amount is distinct from old.settled_amount
     or new.total_amount is distinct from old.total_amount
     or new.subtotal is distinct from old.subtotal
     or new.shipping_cost is distinct from old.shipping_cost
     or new.down_payment_amount is distinct from old.down_payment_amount
     or new.customer_id is distinct from old.customer_id then
    raise exception 'Only DMC staff can confirm payments or change an order''s amounts.';
  end if;

  if new.status is distinct from old.status and new.status <> 'submitted' then
    raise exception 'Customers cannot change an order to %.', new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists customer_orders_protect_payments on public.customer_orders;
create trigger customer_orders_protect_payments
  before update on public.customer_orders
  for each row execute function public.protect_order_payments();


-- Check -----------------------------------------------------------------------
-- Expect the new column, and one trigger.
-- select column_name from information_schema.columns
--   where table_name = 'customer_orders' and column_name = 'pending_payment_amount';
-- select tgname from pg_trigger where tgname = 'customer_orders_protect_payments';
