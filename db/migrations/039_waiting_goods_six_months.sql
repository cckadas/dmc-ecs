-- =============================================================================
-- 039: A rush shipment's waiting goods: 6 months, then DMC's
--
-- After a rush shipment (034) the goods that weren't in yet wait in DMC's
-- warehouse for the customer's next order. Until now nothing ended that wait:
-- they could only leave with an order of new products, there was no deadline,
-- and the rushed order stayed "partly shipped" for good. As DMC decided:
--   - the customer's next order takes them, with other products or with only
--     them (a request with no products of its own: DMC prices only the
--     container and shipping, which the customer pays, as for any order);
--   - an order with nothing new to buy skips purchasing once its down payment
--     is verified (warehouse preparation, or procurement until the goods are in);
--   - the customer has 6 months, counted from when the goods are all in DMC's
--     warehouse and the rushed order's container has left; they and sales are
--     reminded a month and a week before;
--   - after the 6 months, with no order of theirs taking the goods and no
--     request or quotation of theirs still open that would, the goods are
--     DMC's to do with as it wants: their racks are freed, the warehouse is
--     told which to clear, and the rushed order counts as shipped.
-- New rush agreements say so in their words. The server runs the check every
-- 5 minutes (server/waitingGoods.js).
-- Safe to run more than once. The last query shows true, true, true, true.
-- =============================================================================


-- 1. When waiting goods became DMC's ---------------------------------------------------------
alter table public.customer_order_items
  add column if not exists given_to_dmc_at timestamptz;

-- Set by the system only, like a rush shipment's other details (034).
create or replace function public.protect_rush_details()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or coalesce(current_setting('dmc.rush_step', true), '') = 'on' then
    return new;
  end if;

  if tg_table_name = 'customer_order_items' then
    if (tg_op = 'INSERT' and (new.ship_quantity is not null or new.carried_from_item_id is not null
                              or new.po_item_id is not null or coalesce(new.cases_before, 0) <> 0
                              or new.given_to_dmc_at is not null))
       or (tg_op = 'UPDATE' and (new.ship_quantity is distinct from old.ship_quantity
                                 or new.carried_from_item_id is distinct from old.carried_from_item_id
                                 or new.po_item_id is distinct from old.po_item_id
                                 or new.cases_before is distinct from old.cases_before
                                 or new.given_to_dmc_at is distinct from old.given_to_dmc_at)) then
      raise exception 'A rush shipment''s details are set by the system only.';
    end if;
  elsif tg_table_name = 'purchase_order_items' then
    if (tg_op = 'INSERT' and coalesce(new.cases_loaded, 0) <> 0)
       or (tg_op = 'UPDATE' and new.cases_loaded is distinct from old.cases_loaded) then
      raise exception 'The cases loaded into containers are counted by the system only.';
    end if;
  end if;

  return new;
end;
$$;

-- Each reminder, and the end, once per rushed order.
create table if not exists public.waiting_goods_notices (
  customer_order_id uuid not null references public.customer_orders (id) on delete cascade,
  kind text not null check (kind in ('month', 'week', 'given')),
  deadline date not null,
  sent_at timestamptz not null default now(),
  primary key (customer_order_id, kind, deadline)
);

alter table public.waiting_goods_notices enable row level security;
revoke all on public.waiting_goods_notices from anon, authenticated;


-- 2. When the 6 months start and end, for a rushed order ----------------------------------
-- They start once the rushed order's container has left and its waiting goods
-- are all in DMC's warehouse (the later of the two). Empty until then.
create or replace function public.rush_waiting_clock(p_order uuid)
returns table (started_at timestamptz, deadline date)
language sql
stable
security definer
set search_path = public
as $$
  with waiting as (
    select i.id, i.quantity, x.po_item_id
    from customer_order_items i
    cross join lateral public.order_item_line(i.id) x
    where i.customer_order_id = p_order
      and i.ship_quantity is not null
      and i.quantity > i.ship_quantity
  ),
  container_left as (
    select min(h.changed_at) as at
    from customer_order_status_history h
    where h.customer_order_id = p_order
      and lower(trim(h.new_status)) = 'partly shipped'
  ),
  arrived as (
    select bool_and(public.item_cases_in(w.id) >= w.quantity) as all_in,
           max(l.fully_received_at) as at
    from waiting w
    left join purchase_order_items l on l.id = w.po_item_id
  )
  select s.at, ((s.at at time zone 'Asia/Manila')::date + interval '6 months')::date
  from (
    select greatest(c.at, coalesce(a.at, c.at)) as at, c.at as left_at, a.all_in
    from container_left c
    cross join arrived a
  ) s
  where s.left_at is not null
    and s.all_in
$$;

revoke execute on function public.rush_waiting_clock(uuid) from public, anon, authenticated;


-- 3. A customer's waiting goods, with their deadline and whether they're DMC's -------------
-- As in 034, plus given_at and deadline (a changed list, so made again).
drop function if exists public.waiting_goods(uuid);
create function public.waiting_goods(p_customer_id uuid)
returns table (
  item_id uuid, customer_order_id uuid, order_number text, product_id uuid, product_name text,
  pack_size text, unit text, cases integer, cbm numeric, gross_weight_kg numeric,
  agreed_at timestamptz, carried_into text, carried_into_status text,
  given_at timestamptz, deadline date
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_customer_id is distinct from auth.uid()
     and not public.has_role('admin', 'sales', 'procurement', 'warehouse', 'management') then
    raise exception 'You can only see your own goods.';
  end if;

  return query
  select i.id, o.id, o.order_number, i.product_id, p.product_name, p.pack_size, coalesce(p.unit, 'cases'),
         (i.quantity - i.ship_quantity)::integer, p.cbm, p.gross_weight_kg, a.agreed_at,
         nxt.order_number, nxt.status,
         i.given_to_dmc_at, clock.deadline
  from customer_order_items i
  join customer_orders o on o.id = i.customer_order_id
  join order_rush_agreements a on a.customer_order_id = o.id
  join products p on p.id = i.product_id
  left join lateral (
    select o2.order_number, o2.status
    from customer_order_items c
    join customer_orders o2 on o2.id = c.customer_order_id
    where c.carried_from_item_id = i.id
  ) nxt on true
  left join lateral public.rush_waiting_clock(o.id) clock on true
  where o.customer_id = p_customer_id
    and i.ship_quantity is not null
    and i.quantity - i.ship_quantity > 0
  order by a.agreed_at, o.order_number, p.product_name;
end;
$$;

revoke execute on function public.waiting_goods(uuid) from public, anon;
grant execute on function public.waiting_goods(uuid) to authenticated;


-- 4. Goods that are DMC's have left the customer's order ------------------------------------
-- As in 034, plus: given to DMC counts as gone.
create or replace function public.item_waiting_gone(p_item_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_item    customer_order_items;
  v_next    customer_order_items;
  v_status  text;
begin
  select * into v_item from customer_order_items where id = p_item_id;

  if v_item.id is null or v_item.ship_quantity is null or v_item.ship_quantity >= v_item.quantity
     or v_item.given_to_dmc_at is not null then
    return true;
  end if;

  select c.* into v_next from customer_order_items c where c.carried_from_item_id = p_item_id;
  if v_next.id is null then
    return false;
  end if;

  select lower(trim(status)) into v_status from customer_orders where id = v_next.customer_order_id;
  if coalesce(v_status, '') not in ('shipped', 'partly shipped') then
    return false;
  end if;

  return public.item_waiting_gone(v_next.id);
end;
$$;

revoke execute on function public.item_waiting_gone(uuid) from public, anon, authenticated;


-- 5. Approving a quotation -------------------------------------------------------------------
-- As in 034, plus: goods that are DMC's can't be in a quotation, and aren't
-- "left out" of one.
create or replace function public.approve_quotation(p_quotation_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quotation  quotations%rowtype;
  v_request    quotation_requests%rowtype;
  v_order_id   uuid;
  v_number     text;
  v_bad        text;
  v_left_out   text;
  v_taken      text;
  v_given      text;
begin
  select * into v_quotation from quotations where id = p_quotation_id for update;

  if not found then
    raise exception 'This quotation no longer exists.';
  end if;

  select * into v_request from quotation_requests where id = v_quotation.quotation_request_id;

  if v_request.customer_id is distinct from auth.uid() then
    raise exception 'This quotation belongs to another customer.';
  end if;

  if lower(trim(v_quotation.status)) <> 'pending approval' then
    raise exception 'This quotation has already been %.', lower(trim(v_quotation.status));
  end if;

  if v_quotation.expiry_date < (now() at time zone 'Asia/Manila')::date then
    raise exception 'This quotation has expired. Please request a refreshed quote before approving.';
  end if;

  -- Its lines for waiting goods: each must be this customer's waiting cases,
  -- exactly, at ₱0.
  perform 1 from customer_order_items s
  where s.id in (select q.carried_from_item_id from quotation_items q where q.quotation_id = v_quotation.id and q.carried_from_item_id is not null)
  order by s.id
  for update;

  select string_agg(coalesce(p.product_name, 'a product'), ', ') into v_bad
  from quotation_items q
  left join customer_order_items s on s.id = q.carried_from_item_id
  left join customer_orders so on so.id = s.customer_order_id
  left join products p on p.id = q.product_id
  where q.quotation_id = v_quotation.id
    and q.carried_from_item_id is not null
    and (s.id is null
         or so.customer_id is distinct from v_request.customer_id
         or s.ship_quantity is null
         or s.product_id is distinct from q.product_id
         or q.quantity is distinct from s.quantity - s.ship_quantity
         or coalesce(q.unit_price, 0) <> 0
         or coalesce(q.subtotal, 0) <> 0);

  if v_bad is not null then
    raise exception 'This quotation''s goods from an earlier order don''t match what is waiting (%). DMC must make the quotation again.', v_bad;
  end if;

  select string_agg(distinct so.order_number, ', ') into v_given
  from quotation_items q
  join customer_order_items s on s.id = q.carried_from_item_id
  join customer_orders so on so.id = s.customer_order_id
  where q.quotation_id = v_quotation.id
    and s.given_to_dmc_at is not null;

  if v_given is not null then
    raise exception 'The goods waiting from % passed 6 months without an order, so they are DMC''s now. DMC must make this quotation again without them.', v_given;
  end if;

  select string_agg(distinct o2.order_number, ', ') into v_taken
  from quotation_items q
  join customer_order_items c on c.carried_from_item_id = q.carried_from_item_id
  join customer_orders o2 on o2.id = c.customer_order_id
  where q.quotation_id = v_quotation.id;

  if v_taken is not null then
    raise exception 'The goods waiting from an earlier order already go with %. DMC must make this quotation again.', v_taken;
  end if;

  -- None left out: waiting goods agreed before this quotation was made go in it.
  select string_agg(distinct w.order_number, ', ') into v_left_out
  from customer_order_items i
  join customer_orders w on w.id = i.customer_order_id
  join order_rush_agreements a on a.customer_order_id = w.id
  where w.customer_id = v_request.customer_id
    and i.ship_quantity is not null
    and i.quantity - i.ship_quantity > 0
    and i.given_to_dmc_at is null
    and a.agreed_at < v_quotation.created_at
    and not exists (select 1 from customer_order_items c where c.carried_from_item_id = i.id)
    and not exists (select 1 from quotation_items q where q.quotation_id = v_quotation.id and q.carried_from_item_id = i.id);

  if v_left_out is not null then
    raise exception 'This quotation leaves out the goods waiting from %, which go in your next order''s container. DMC must make the quotation again with them.', v_left_out;
  end if;

  v_number := next_document_number('ORD');

  insert into customer_orders (
    order_number, customer_id, quotation_id, quotation_number, subtotal, shipping_cost,
    container_size, container_cost, total_amount, down_payment_amount, delivery_location_id,
    pfi_file_path, expiry_date, status
  )
  values (
    v_number, v_request.customer_id, v_quotation.id, v_quotation.quotation_number,
    v_quotation.subtotal, v_quotation.shipping_cost, v_quotation.container_size,
    v_quotation.container_cost, v_quotation.total_amount, v_quotation.down_payment_amount,
    v_request.delivery_location_id, v_quotation.pfi_file_path, v_quotation.expiry_date,
    'pending payment'
  )
  returning id into v_order_id;

  insert into customer_order_items (customer_order_id, product_id, quantity, unit_price, subtotal)
  select v_order_id, product_id, quantity, unit_price, subtotal
  from quotation_items
  where quotation_id = v_quotation.id
    and carried_from_item_id is null;

  -- The waiting goods, with where their cases are.
  perform set_config('dmc.rush_step', 'on', true);

  insert into customer_order_items
    (customer_order_id, product_id, quantity, unit_price, subtotal, carried_from_item_id, po_item_id, cases_before)
  select v_order_id, q.product_id, q.quantity, 0, 0, s.id, x.po_item_id, x.cases_before + s.ship_quantity
  from quotation_items q
  join customer_order_items s on s.id = q.carried_from_item_id
  cross join lateral public.order_item_line(s.id) x
  where q.quotation_id = v_quotation.id;

  perform set_config('dmc.rush_step', 'off', true);

  -- The order's first step, for the progress tracker and predictions.
  insert into customer_order_status_history (customer_order_id, previous_status, new_status)
  values (v_order_id, 'quotation approved', 'pending payment');

  update quotations set status = 'approved' where id = v_quotation.id;
  update quotation_requests set status = 'approved' where id = v_request.id;

  return v_number;
end;
$$;

revoke execute on function public.approve_quotation(uuid) from public, anon;
grant execute on function public.approve_quotation(uuid) to authenticated;


-- 6. An order of waiting goods alone: nothing to buy ------------------------------------------
-- Once its down payment is verified it moves on by itself: to warehouse
-- preparation when its goods are all in, or to procurement until they are
-- (receiving them moves it on, as for any order: 034).
create or replace function public.move_on_nothing_to_buy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next text;
begin
  if coalesce(lower(trim(new.status)), '') <> 'payment verified'
     or coalesce(lower(trim(old.status)), '') = 'payment verified' then
    return null;
  end if;

  if exists (select 1 from customer_order_items where customer_order_id = new.id and carried_from_item_id is null)
     or not exists (select 1 from customer_order_items where customer_order_id = new.id) then
    return null;
  end if;

  v_next := case when public.order_cases_waiting(new.id) = 0 then 'warehouse preparation' else 'procurement' end;

  update customer_orders set status = v_next where id = new.id;

  insert into customer_order_status_history (customer_order_id, previous_status, new_status, changed_at)
  values (new.id, 'payment verified', v_next, clock_timestamp());

  begin
    insert into notifications (user_id, role, title, message, type, link, related_customer_order_id)
    values (
      new.customer_id, 'customer',
      format('%s is now in %s', new.order_number, v_next),
      case when v_next = 'warehouse preparation'
        then format('Your order %s has only goods already in DMC''s warehouse, so it goes straight to warehouse preparation.', new.order_number)
        else format('Your order %s has only goods already bought on an earlier order. It moves on to warehouse preparation as soon as they''re all in.', new.order_number)
      end,
      'info', '/my-orders', new.id
    );
  exception when foreign_key_violation then
    null;
  end;

  return null;
end;
$$;

revoke execute on function public.move_on_nothing_to_buy() from public, anon, authenticated;

drop trigger if exists customer_orders_nothing_to_buy on public.customer_orders;
create trigger customer_orders_nothing_to_buy
  after update of status on public.customer_orders
  for each row execute function public.move_on_nothing_to_buy();


-- 7. Reminders, and the end of the 6 months, run by the server every 5 minutes ---------------
-- For each rushed order with goods that no order of the customer's has taken:
--   a month before the deadline   -> reminder to the customer and sales
--   a week before                 -> reminder again
--   on the deadline               -> the goods are DMC's: racks freed, the
--                                    customer, sales and the warehouse told
-- Each goes out once; only the latest due applies. A request of the customer's
-- still waiting for a price, or a quotation with the goods still open, keeps
-- them until it's answered (DMC's pricing time never costs the customer).
-- p_today stands in for today (Philippine time) in rehearsals; p_dry_run says
-- what would happen without changing anything.
create or replace function public.apply_waiting_goods_deadlines(p_today date default null, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today       date := coalesce(p_today, (now() at time zone 'Asia/Manila')::date);
  v_order       record;
  v_line        record;
  v_lines       jsonb;
  v_list        text;
  v_deadline    date;
  v_kind        text;
  v_open        text;
  v_racks       text;
  v_new         integer;
  v_reminders   jsonb := '[]'::jsonb;
  v_given       jsonb := '[]'::jsonb;
  v_held        jsonb := '[]'::jsonb;
  c_day         constant text := 'FMMon FMDD, YYYY';
begin
  for v_order in
    select o.id, o.order_number, o.customer_id, o.status
    from customer_orders o
    join order_rush_agreements a on a.customer_order_id = o.id
    where coalesce(lower(trim(o.status)), '') <> 'cancelled'
    order by o.order_number
    for update of o
  loop
    -- Its goods still waiting: none given to DMC, none taken by an order.
    select coalesce(jsonb_agg(jsonb_build_object(
             'item', i.id, 'line', x.po_item_id,
             'product', coalesce(p.product_name, 'a product'),
             'cases', i.quantity - i.ship_quantity,
             'unit', coalesce(p.unit, 'cases')) order by p.product_name), '[]'::jsonb)
    into v_lines
    from customer_order_items i
    left join products p on p.id = i.product_id
    cross join lateral public.order_item_line(i.id) x
    where i.customer_order_id = v_order.id
      and i.ship_quantity is not null
      and i.quantity > i.ship_quantity
      and i.given_to_dmc_at is null
      and not exists (select 1 from customer_order_items c where c.carried_from_item_id = i.id);

    continue when jsonb_array_length(v_lines) = 0;

    select c.deadline into v_deadline from public.rush_waiting_clock(v_order.id) c;
    continue when v_deadline is null;

    v_kind := case
      when v_today >= v_deadline then 'given'
      when v_today >= v_deadline - 7 then 'week'
      when v_today >= (v_deadline - interval '1 month')::date then 'month'
    end;
    continue when v_kind is null;

    if v_kind <> 'given' and exists (
      select 1 from waiting_goods_notices n
      where n.customer_order_id = v_order.id and n.kind = v_kind and n.deadline = v_deadline
    ) then
      continue;
    end if;

    -- A request or quotation still open that would take them: wait for it.
    if v_kind = 'given' then
      select string_agg(x.reference, ', ' order by x.reference) into v_open
      from (
        select r.quotation_reference as reference
        from quotation_requests r
        where r.customer_id = v_order.customer_id
          and lower(trim(r.status)) = 'awaiting pricing'
        union
        select q.quotation_number
        from quotations q
        join quotation_items qi on qi.quotation_id = q.id
        join customer_order_items i on i.id = qi.carried_from_item_id
        where i.customer_order_id = v_order.id
          and lower(trim(q.status)) = 'pending approval'
          and q.expiry_date >= v_today
      ) x;

      if v_open is not null then
        v_held := v_held || jsonb_build_object('order', v_order.order_number, 'open', v_open);
        continue;
      end if;
    end if;

    select string_agg(format('%s: %s %s', e ->> 'product', e ->> 'cases', e ->> 'unit'), ', ')
    into v_list
    from jsonb_array_elements(v_lines) e;

    if p_dry_run then
      if v_kind = 'given' then
        v_given := v_given || to_jsonb(v_order.order_number);
      else
        v_reminders := v_reminders || jsonb_build_object('order', v_order.order_number, 'kind', v_kind);
      end if;
      continue;
    end if;

    insert into waiting_goods_notices (customer_order_id, kind, deadline)
    values (v_order.id, v_kind, v_deadline)
    on conflict do nothing;
    get diagnostics v_new = row_count;
    continue when v_new = 0;

    if v_kind = 'given' then
      -- The racks they're on, for the warehouse, before they're freed.
      select string_agg(distinct coalesce(w.rack_id, w.name), ', ') into v_racks
      from jsonb_array_elements(v_lines) e
      join purchase_order_item_racks r on r.purchase_order_item_id = (e ->> 'line')::uuid
      join warehouse_racks w on w.id = r.warehouse_rack_id;

      perform set_config('dmc.rush_step', 'on', true);
      update customer_order_items
      set given_to_dmc_at = now()
      where id in (select (e ->> 'item')::uuid from jsonb_array_elements(v_lines) e);
      perform set_config('dmc.rush_step', 'off', true);

      for v_line in
        select (e ->> 'line')::uuid as line, (e ->> 'cases')::integer as cases
        from jsonb_array_elements(v_lines) e
      loop
        perform public.release_line_cases(v_line.line, v_line.cases);
      end loop;

      -- Nothing of the rushed order left to ship: it counts as shipped.
      if lower(trim(v_order.status)) = 'partly shipped'
         and not exists (
           select 1 from customer_order_items s
           where s.customer_order_id = v_order.id
             and not public.item_waiting_gone(s.id)
         ) then
        update customer_orders set status = 'shipped' where id = v_order.id;
        insert into customer_order_status_history (customer_order_id, previous_status, new_status, changed_at)
        values (v_order.id, 'partly shipped', 'shipped', now());
      end if;

      begin
        insert into notifications (user_id, role, title, message, type, link, related_customer_order_id)
        values
          (v_order.customer_id, 'customer',
           format('%s - Waiting goods are DMC''s now', v_order.order_number),
           format('Your goods from %s (%s) waited until %s, 6 months, without an order taking them. As agreed in your rush shipment, DMC may now do what it wants with them.',
             v_order.order_number, v_list, to_char(v_deadline, c_day)),
           'warning', '/my-orders', v_order.id),
          (v_order.customer_id, 'sales',
           format('%s - Waiting goods passed 6 months', v_order.order_number),
           format('%s''s waiting goods (%s) passed 6 months on %s without a next order, so they are DMC''s now. The warehouse was told to clear them.',
             v_order.order_number, v_list, to_char(v_deadline, c_day)),
           'info', '/customer-orders', v_order.id),
          (v_order.customer_id, 'warehouse',
           format('%s - Clear its waiting goods (DMC''s now)', v_order.order_number),
           format('%s''s waiting goods passed 6 months without a next order and are DMC''s now: %s.%s Their racks are free in the system.',
             v_order.order_number, v_list, coalesce(format(' On racks %s.', v_racks), '')),
           'info', '/warehouse-holdings', v_order.id);
      exception when foreign_key_violation then
        null;  -- the customer's sign-in no longer exists: nobody to tell
      end;

      v_given := v_given || to_jsonb(v_order.order_number);
    else
      begin
        insert into notifications (user_id, role, title, message, type, link, related_customer_order_id)
        values
          (v_order.customer_id, 'customer',
           format('%s - Send your next order by %s', v_order.order_number, to_char(v_deadline, c_day)),
           format('Your goods from %s (%s) are waiting in DMC''s warehouse for your next order. Send a quotation request by %s, with other products or with only these; that order''s container and shipping are yours to pay. After %s, as agreed, DMC may do what it wants with them.',
             v_order.order_number, v_list, to_char(v_deadline, c_day), to_char(v_deadline, c_day)),
           'warning', '/quotation-requests', v_order.id),
          (v_order.customer_id, 'sales',
           format('%s - Waiting goods: %s left', v_order.order_number, case v_kind when 'month' then 'a month' else 'a week' end),
           format('%s''s waiting goods (%s) have had no next order. If none takes them by %s, they become DMC''s.',
             v_order.order_number, v_list, to_char(v_deadline, c_day)),
           'info', '/customer-orders', v_order.id);
      exception when foreign_key_violation then
        null;
      end;

      v_reminders := v_reminders || jsonb_build_object('order', v_order.order_number, 'kind', v_kind);
    end if;
  end loop;

  return jsonb_build_object('reminders', v_reminders, 'given', v_given, 'held_by_open_requests', v_held, 'dry_run', p_dry_run);
end;
$$;

revoke execute on function public.apply_waiting_goods_deadlines(date, boolean) from public, anon, authenticated;
grant execute on function public.apply_waiting_goods_deadlines(date, boolean) to service_role;


-- 8. The words a customer agrees to, for new rush shipments ----------------------------------
-- As in 034, point 2 saying all of the above. Agreements already made keep
-- the words they were made with.
create or replace function public.rush_terms(p_order_number text)
returns text
language sql
immutable
as $$
  select format(
'Rush shipment for %1$s

1. Only the goods under "Ships now" go in this order''s container. They are labeled, loaded and shipped as soon as they''re ready.
2. The goods under "Waits for your next order" are not shipped now. When they arrive, DMC keeps them and puts them in the container of your next order with DMC: with other products, or with only these goods. Either way, that order''s container and shipping are yours to pay, as for any order. Send the request for it within 6 months of the day they are all in DMC''s warehouse and this order''s container has left. After that, you give DMC the right to do what it wants with them, to free its storage.
3. %1$s''s price and balance stay the same. The waiting goods are already part of %1$s, so they are not charged again on your next order. Your next order''s container is chosen to fit them too, which can make it a bigger container.
4. Once you agree, this can''t be undone.', p_order_number)
$$;


-- Check: true, true, true, true.
select
  to_regprocedure('public.apply_waiting_goods_deadlines(date, boolean)') is not null as six_month_check,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'customer_order_items' and column_name = 'given_to_dmc_at') as given_to_dmc_recorded,
  exists (select 1 from pg_trigger where tgname = 'customer_orders_nothing_to_buy') as goods_only_orders_move_on,
  position('6 months' in public.rush_terms('ORD-X')) > 0 as agreement_says_so;
