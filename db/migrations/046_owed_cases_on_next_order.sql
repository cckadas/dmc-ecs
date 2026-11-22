-- =============================================================================
-- 046: Owed cases count toward DMC's next purchase order
--
-- DMC's rule (2026-11-22). Cases a supplier didn't deliver although DMC had
-- paid for them (045, "Owed by suppliers") count toward the next purchase order
-- that orders that product from that supplier, for any customer: the supplier
-- delivers the whole quantity, and DMC pays only for the rest.
--   - purchase_order_items.owed_cases: how many of the line's cases are owed
--     cases (already paid). What DMC pays for the line is
--     (ordered - owed) x price; the supplier's invoice and DMC's payment are
--     checked against that (015).
--   - supplier_owed_uses: which owed cases went to which line, oldest first.
-- Owed cases refunded by the supplier (045) aren't used. Purchase orders made
-- before this are unchanged. Needs 045. Safe to run more than once. The last
-- query shows true, true, true.
-- =============================================================================


-- 1. Owed cases on a purchase order line, and where each went -----------------------------------
alter table public.purchase_order_items add column if not exists owed_cases integer not null default 0;
alter table public.purchase_order_items drop constraint if exists purchase_order_items_owed_cases_range;
alter table public.purchase_order_items add constraint purchase_order_items_owed_cases_range
  check (owed_cases >= 0 and owed_cases <= coalesce(ordered_quantity, 0));

create table if not exists public.supplier_owed_uses (
  id uuid primary key default gen_random_uuid(),
  owed_id uuid not null references public.supplier_owed_cases (id) on delete cascade,
  purchase_order_item_id uuid not null references public.purchase_order_items (id) on delete cascade,
  cases integer not null check (cases > 0),
  created_at timestamptz not null default now(),
  unique (owed_id, purchase_order_item_id)
);

alter table public.supplier_owed_uses enable row level security;
revoke all on public.supplier_owed_uses from anon, authenticated;
grant select on public.supplier_owed_uses to authenticated;
drop policy if exists "staff: read owed uses" on public.supplier_owed_uses;
create policy "staff: read owed uses" on public.supplier_owed_uses
  for select to authenticated
  using ((select public.has_role('admin', 'procurement', 'sales', 'management', 'warehouse')));


-- 2. Making a purchase order: owed cases count, oldest first -----------------------------------
-- As in 034, plus: each line takes the owed cases of its product from its
-- supplier, and the total (checked against the form's) is what DMC pays.
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
  v_line       record;
  v_owed       record;
  v_need       integer;
  v_take       integer;
  v_used       integer := 0;
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
         string_agg(p.product_name, ', ' order by p.product_name) filter (where l.id is null)
    into v_items, v_no_amount, v_missing
  from customer_order_items i
  join products p on p.id = i.product_id
  left join supplier_price_list l
    on l.supplier_id = p.supplier_id and l.product_id = p.id and l.effective_to is null
  where i.customer_order_id = p_customer_order_id
    and i.carried_from_item_id is null;

  if v_items = 0 then
    raise exception '% has no products to order.', v_order.order_number;
  end if;

  if v_no_amount > 0 then
    raise exception 'A product on % has no quantity to order.', v_order.order_number;
  end if;

  if v_missing is not null then
    raise exception 'No current supplier price for: %. Add it in Price Lists first.', v_missing;
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
  where i.customer_order_id = p_customer_order_id
    and i.carried_from_item_id is null;

  -- Cases the supplier owes for this product count first, oldest first.
  for v_line in
    select id, supplier_id, product_id, ordered_quantity
    from purchase_order_items
    where purchase_order_id = v_po.id
    order by product_id, id
  loop
    v_need := v_line.ordered_quantity;

    for v_owed in
      select id, cases - used_cases as open_cases
      from supplier_owed_cases
      where supplier_id = v_line.supplier_id
        and product_id = v_line.product_id
        and refunded_at is null
        and used_cases < cases
      order by created_at, id
      for update
    loop
      exit when v_need <= 0;
      v_take := least(v_need, v_owed.open_cases);

      update supplier_owed_cases set used_cases = used_cases + v_take where id = v_owed.id;
      insert into supplier_owed_uses (owed_id, purchase_order_item_id, cases) values (v_owed.id, v_line.id, v_take);
      update purchase_order_items set owed_cases = owed_cases + v_take where id = v_line.id;

      v_need := v_need - v_take;
      v_used := v_used + v_take;
    end loop;
  end loop;

  -- What DMC pays: the owed cases are already paid for.
  select coalesce(sum((ordered_quantity - owed_cases) * unit_price), 0) into v_total
  from purchase_order_items
  where purchase_order_id = v_po.id;

  if p_expected_total is not null and abs(v_total - p_expected_total) > 0.01 then
    raise exception 'A supplier''s price, or the cases a supplier owes, changed after you opened this form: the total is now %. Nothing was created. Open the form again to see it.',
      '₱ ' || to_char(v_total, 'FM999,999,999,990.00');
  end if;

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
    'total', v_total,
    'owed_cases_used', v_used
  );
end;
$$;

revoke execute on function public.create_purchase_order(uuid, date, numeric) from public, anon;
grant execute on function public.create_purchase_order(uuid, date, numeric) to authenticated;


-- 3. The supplier's invoice is checked against what DMC pays -----------------------------------
-- As in 015, less the owed cases (already paid).
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
    select coalesce(sum((ordered_quantity - coalesce(owed_cases, 0)) * unit_price), 0) into v_po_total
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


-- Check: true, true, true.
select
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'purchase_order_items' and column_name = 'owed_cases') as owed_on_lines,
  to_regclass('public.supplier_owed_uses') is not null as owed_uses_kept,
  position('owed_cases' in pg_get_functiondef('public.enforce_supplier_amounts()'::regprocedure)) > 0 as invoices_checked_less_owed;
