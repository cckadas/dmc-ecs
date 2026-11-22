-- =============================================================================
-- 027  Checking a payment and making a purchase order, each in one step
--
-- Two steps were done by the screen as several separate saves. When two people
-- did the same step at the same moment, both went through:
--
--   Checking a customer's payment. The second person's click changed nothing,
--   but the step was still recorded again and the customer was still notified,
--   so a customer could be told "rejected" for a payment that was verified.
--
--   Making the purchase order. Both were saved, so the goods were ordered from
--   the suppliers twice.
--
-- review_order_payment() checks a payment all at once, or not at all:
--   - only sales staff (and admin)
--   - only the payment that was on the reviewer's screen: the same amount and
--     the same proof. One already checked by someone else, or replaced by the
--     customer since, is refused and nothing changes (a second click waits,
--     then is refused)
--   - counts the amount as paid or drops it, moves a first payment's order to
--     payment verified or payment rejected, records it, and tells the customer
--
-- create_purchase_order() makes an order's purchase order all at once, or not
-- at all:
--   - only procurement staff (and admin)
--   - only for an order whose down payment is verified and that has no
--     purchase order yet (a second click waits, then is refused)
--   - its lines are the order's own products and quantities, each from the
--     product's supplier at that supplier's current price-list price
--   - moves the order to procurement, records it, and tells the customer
--
-- And however a purchase order is made, the database now refuses a second one
-- for the same customer order. Orders that already have two, made before this
-- script, are left as they are; the last query lists them.
--
-- Run after 026. Safe to run more than once. The last query shows the three
-- true/false columns true.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Checking a payment
--
-- p_expected_amount, p_expected_proof_dp and p_expected_proof_complete are what
-- the reviewer's screen showed: the amount waiting and the order's two proof
-- files. Returns the order's payment details as they are afterwards.
-- -----------------------------------------------------------------------------
create or replace function public.review_order_payment(
  p_customer_order_id        uuid,
  p_approve                  boolean,
  p_expected_amount          numeric,
  p_expected_proof_dp        text,
  p_expected_proof_complete  text,
  p_rejection_reason         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   customer_orders%rowtype;
  v_amount  numeric;
  v_first   boolean;
  v_reason  text := nullif(trim(coalesce(p_rejection_reason, '')), '');
  v_last    record;
  v_money   text;
begin
  if not public.has_role('admin', 'sales') then
    raise exception 'Only sales staff can check a payment.';
  end if;

  if p_approve is null then
    raise exception 'Say whether the payment is approved or rejected.';
  end if;

  if not p_approve and v_reason is null then
    raise exception 'A rejection reason is required.';
  end if;

  -- One at a time: a second click waits here, then finds the payment checked.
  select * into v_order from customer_orders o where o.id = p_customer_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;

  v_amount := coalesce(v_order.pending_payment_amount, 0);

  -- The first payment is checked while the order is submitted; a balance
  -- payment whenever one is waiting, whatever the order's stage.
  v_first := coalesce(lower(trim(v_order.status)) = 'submitted', false);

  -- Nothing is waiting: someone has checked it already.
  if v_amount <= 0 and not v_first then
    select h.event, nullif(trim(h.done_by_name), '') as done_by_name into v_last
    from customer_order_payment_history h
    where h.customer_order_id = p_customer_order_id
      and h.event in ('payment verified', 'payment rejected')
    order by h.happened_at desc
    limit 1;

    if found then
      raise exception 'This payment was already checked (this order''s last payment was %). Nothing was changed.',
        (case when v_last.event = 'payment verified' then 'verified' else 'rejected' end)
          || coalesce(' by ' || v_last.done_by_name, '');
    end if;

    raise exception 'There is no payment waiting to be checked on this order. Nothing was changed.';
  end if;

  -- Only the payment that was on screen, not one the customer sent since.
  if round(coalesce(p_expected_amount, 0), 2) <> round(v_amount, 2)
     or nullif(p_expected_proof_dp, '') is distinct from nullif(v_order.payment_proof_dp, '')
     or nullif(p_expected_proof_complete, '') is distinct from nullif(v_order.payment_proof_complete, '') then
    raise exception 'This payment changed after you opened it. Nothing was changed. Open the payment again to check the new one.';
  end if;

  if p_approve then
    -- The amount now counts as paid, and lowers what the customer owes.
    update customer_orders
    set settled_amount = coalesce(settled_amount, 0) + v_amount,
        pending_payment_amount = 0,
        rejection_reason = null,
        status = case when v_first then 'payment verified' else status end
    where id = p_customer_order_id;
  else
    -- The amount is dropped. A rejected first payment ends the order's payment
    -- stage; a rejected balance proof is cleared so the customer uploads a new one.
    update customer_orders
    set pending_payment_amount = 0,
        rejection_reason = v_reason,
        status = case when v_first then 'payment rejected' else status end,
        payment_proof_complete = case when v_first then payment_proof_complete else null end
    where id = p_customer_order_id;
  end if;

  if v_first then
    insert into customer_order_status_history (customer_order_id, previous_status, new_status, changed_at)
    values (p_customer_order_id, 'submitted', case when p_approve then 'payment verified' else 'payment rejected' end, now());
  end if;

  -- Tell the customer, once.
  v_money := '₱ ' || to_char(v_amount, 'FM999,999,999,990.00');

  begin
    insert into notifications (user_id, role, title, message, type, link, related_customer_order_id)
    values (
      v_order.customer_id,
      'customer',
      format('%s - Payment %s', v_order.order_number, case when p_approve then 'verified' else 'rejected' end),
      case when p_approve
        then format('Your payment of %s for order %s has been verified.', v_money, v_order.order_number)
        else format('Your payment of %s for order %s was rejected: %s', v_money, v_order.order_number, v_reason)
      end,
      case when p_approve then 'success' else 'error' end,
      '/payments',
      p_customer_order_id
    );
  exception when foreign_key_violation then
    -- The customer's account no longer exists. The check itself still stands.
    null;
  end;

  select * into v_order from customer_orders o where o.id = p_customer_order_id;

  return jsonb_build_object(
    'order_number', v_order.order_number,
    'status', v_order.status,
    'settled_amount', v_order.settled_amount,
    'pending_payment_amount', v_order.pending_payment_amount,
    'rejection_reason', v_order.rejection_reason,
    'payment_proof_complete', v_order.payment_proof_complete
  );
end;
$$;

revoke execute on function public.review_order_payment(uuid, boolean, numeric, text, text, text) from public, anon;
grant execute on function public.review_order_payment(uuid, boolean, numeric, text, text, text) to authenticated;


-- -----------------------------------------------------------------------------
-- Making a purchase order
--
-- p_expected_total is the total the Add Purchase Order form showed. When a
-- supplier's price changed since the form was opened, the purchase order is
-- refused rather than made at a price nobody saw. Returns the new purchase
-- order's id and number.
-- -----------------------------------------------------------------------------
create or replace function public.create_purchase_order(
  p_customer_order_id       uuid,
  p_expected_delivery_date  date,
  p_expected_total          numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order      customer_orders%rowtype;
  v_existing   text;
  v_items      integer;
  v_no_amount  integer;
  v_missing    text;
  v_total      numeric;
  v_po         purchase_orders%rowtype;
begin
  if not public.has_role('admin', 'procurement') then
    raise exception 'Only procurement staff can create a purchase order.';
  end if;

  if p_expected_delivery_date is null then
    raise exception 'Set the expected delivery date first.';
  end if;

  -- One at a time: a second click waits here, then finds the purchase order made.
  select * into v_order from customer_orders o where o.id = p_customer_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;

  select string_agg(po.po_number, ', ' order by po.created_at, po.po_number) into v_existing
  from purchase_orders po
  where po.customer_order_id = p_customer_order_id;

  if v_existing is not null then
    raise exception '% already has a purchase order (%). Nothing was created.', v_order.order_number, v_existing;
  end if;

  if coalesce(lower(trim(v_order.status)), '') <> 'payment verified' then
    raise exception 'A purchase order can only be made once the order''s down payment is verified. % is at "%".',
      v_order.order_number, coalesce(v_order.status, 'no status');
  end if;

  -- The order's own products and quantities, each from the product's supplier
  -- at that supplier's current price-list price.
  select count(*),
         count(*) filter (where i.quantity <= 0),
         string_agg(p.product_name, ', ' order by p.product_name) filter (where l.id is null),
         sum(i.quantity * l.unit_price)
    into v_items, v_no_amount, v_missing, v_total
  from customer_order_items i
  join products p on p.id = i.product_id
  left join supplier_price_list l
    on l.supplier_id = p.supplier_id and l.product_id = p.id and l.effective_to is null
  where i.customer_order_id = p_customer_order_id;

  if v_items = 0 then
    raise exception '% has no products to order.', v_order.order_number;
  end if;

  if v_no_amount > 0 then
    raise exception 'A product on % has no quantity to order.', v_order.order_number;
  end if;

  if v_missing is not null then
    raise exception 'No current supplier price for: %. Add it in Price Lists first.', v_missing;
  end if;

  if p_expected_total is not null and abs(v_total - p_expected_total) > 0.01 then
    raise exception 'A supplier''s price changed after you opened this form: the total is now %. Nothing was created. Open the form again to see the new prices.',
      '₱ ' || to_char(v_total, 'FM999,999,999,990.00');
  end if;

  -- The database gives it the next number (PO-2026-00001).
  insert into purchase_orders (customer_order_id, expected_delivery_date, status)
  values (p_customer_order_id, p_expected_delivery_date, 'sent to supplier')
  returning * into v_po;

  insert into purchase_order_items
    (purchase_order_id, product_id, supplier_id, ordered_quantity, received_quantity, unit_price, status)
  select v_po.id, i.product_id, p.supplier_id, i.quantity, 0, l.unit_price, 'sent to supplier'
  from customer_order_items i
  join products p on p.id = i.product_id
  join supplier_price_list l
    on l.supplier_id = p.supplier_id and l.product_id = p.id and l.effective_to is null
  where i.customer_order_id = p_customer_order_id;

  -- The order moves on, once.
  update customer_orders
  set status = 'procurement'
  where id = p_customer_order_id;

  insert into customer_order_status_history (customer_order_id, previous_status, new_status, changed_at)
  values (p_customer_order_id, 'payment verified', 'procurement', now());

  begin
    insert into notifications (user_id, role, title, message, type, link, related_customer_order_id)
    values (
      v_order.customer_id,
      'customer',
      format('%s is now in procurement', v_order.order_number),
      format('Your order %s status is now "Procurement". Please check your order details for more information.', v_order.order_number),
      'info',
      '/my-orders',
      p_customer_order_id
    );
  exception when foreign_key_violation then
    -- The customer's account no longer exists. The purchase order still stands.
    null;
  end;

  return jsonb_build_object(
    'purchase_order_id', v_po.id,
    'po_number', v_po.po_number,
    'order_number', v_order.order_number,
    'lines', v_items,
    'total', v_total
  );
end;
$$;

revoke execute on function public.create_purchase_order(uuid, date, numeric) from public, anon;
grant execute on function public.create_purchase_order(uuid, date, numeric) to authenticated;


-- -----------------------------------------------------------------------------
-- One purchase order for each customer order, however it is made
--
-- The trigger's name sorts before purchase_orders_number on purpose: triggers
-- run in name order, so a refused purchase order never takes a PO number.
-- -----------------------------------------------------------------------------
create or replace function public.block_second_purchase_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_number  text;
  v_existing      text;
begin
  -- One at a time for the same customer order: a second purchase order made
  -- at the same moment waits here, then finds the first.
  select o.order_number into v_order_number
  from customer_orders o
  where o.id = new.customer_order_id
  for update;

  select string_agg(po.po_number, ', ' order by po.created_at, po.po_number) into v_existing
  from purchase_orders po
  where po.customer_order_id = new.customer_order_id;

  if v_existing is not null then
    raise exception '% already has a purchase order (%). Nothing was created.',
      coalesce(v_order_number, 'This order'), v_existing;
  end if;

  return new;
end;
$$;

revoke execute on function public.block_second_purchase_order() from public, anon, authenticated;

drop trigger if exists purchase_orders_block_second on public.purchase_orders;
create trigger purchase_orders_block_second
  before insert on public.purchase_orders
  for each row execute function public.block_second_purchase_order();


-- -----------------------------------------------------------------------------
-- Check: the three true/false columns true. The last column lists any order
-- that already had more than one purchase order before this script (they are
-- left as they are), or says none.
-- -----------------------------------------------------------------------------
select
  to_regprocedure('public.review_order_payment(uuid, boolean, numeric, text, text, text)') is not null
    as payment_check_in_one_step,
  to_regprocedure('public.create_purchase_order(uuid, date, numeric)') is not null
    as purchase_order_in_one_step,
  exists (select 1 from pg_trigger where tgname = 'purchase_orders_block_second' and not tgisinternal)
    as one_purchase_order_per_order,
  coalesce((
    select string_agg(doubled.summary, '; ' order by doubled.summary)
    from (
      select o.order_number || ' (' || string_agg(po.po_number, ', ' order by po.created_at, po.po_number) || ')' as summary
      from purchase_orders po
      join customer_orders o on o.id = po.customer_order_id
      group by o.id, o.order_number
      having count(*) > 1
    ) doubled
  ), 'none') as orders_that_already_had_two;
