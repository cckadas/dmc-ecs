-- =============================================================================
-- 041: A rush shipment's waiting goods: 2 weeks, then DMC's
--
-- DMC's rule (2026-11-21), in place of 039's 6 months. After a rush shipment
-- (034) the goods that weren't in yet wait in DMC's warehouse for the
-- customer's next order. Now:
--   - the customer has 2 weeks, counted as before (039) from when the goods
--     are all in DMC's warehouse and the rushed order's container has left;
--   - within them the next order must be CONFIRMED: its quotation approved.
--     A request or a quotation still waiting on the last day no longer holds
--     the goods (039 let it, so a request sent on the last day and rejected
--     later could stretch the wait);
--   - the customer and sales are told when the 2 weeks start, a week before
--     and 2 days before their last day;
--   - the day after the last day, with no order of theirs taking the goods,
--     they are DMC's: their racks are freed, the warehouse is told which to
--     clear, and the rushed order counts as shipped (as in 039). A quotation
--     still waiting with them in it is withdrawn (kept on record) and its
--     request goes back to DMC to be priced again without them; a request for
--     those goods alone is cancelled once the customer has none waiting.
--
-- Fixed on the way: 039 gave the goods to DMC ON the last day the customer was
-- shown ("send a quotation request by Dec 5", gone on Dec 5). The last day is
-- now the last day: they are DMC's from the day after, as a quotation expires
-- (035) and an unpaid order is cancelled (028) the day after theirs.
--
-- Rush agreements already made switch to the 2 weeks too (there were none on
-- Nov 21, 2026; the last query counts them). New ones say 2 weeks in their
-- words. Needs 039 and 040. Safe to run more than once. The last query shows
-- true, true, true, true, and how many rush agreements are on record.
-- =============================================================================


-- 1. The reminders: when the 2 weeks start, a week before, 2 days before -----------------
-- ('month' stays allowed for any reminder 039 already sent.)
alter table public.waiting_goods_notices drop constraint if exists waiting_goods_notices_kind_check;
alter table public.waiting_goods_notices
  add constraint waiting_goods_notices_kind_check
  check (kind in ('start', 'week', 'days', 'given', 'month'));


-- 2. When the 2 weeks start and end, for a rushed order --------------------------------------
-- As in 039, 2 weeks instead of 6 months. They start once the rushed order's
-- container has left and its waiting goods are all in DMC's warehouse (the
-- later of the two); deadline is the LAST day the next order can be approved.
-- Empty until then.
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
  select s.at, (s.at at time zone 'Asia/Manila')::date + 14
  from (
    select greatest(c.at, coalesce(a.at, c.at)) as at, c.at as left_at, a.all_in
    from container_left c
    cross join arrived a
  ) s
  where s.left_at is not null
    and s.all_in
$$;

revoke execute on function public.rush_waiting_clock(uuid) from public, anon, authenticated;
grant execute on function public.rush_waiting_clock(uuid) to service_role;


-- 3. Approving a quotation --------------------------------------------------------------------
-- As in 039, plus: once the waiting goods' 2 weeks are over they can't join an
-- order, even in the minutes before the server's check hands them to DMC.
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
  v_late       text;
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
    raise exception 'The goods waiting from % had no approved order within their 2 weeks, so they are DMC''s now and this quotation can''t be approved. DMC prices your request again without them.', v_given;
  end if;

  -- Their 2 weeks are over, even if the server's check hasn't handed them to
  -- DMC yet: the next order had to be approved by their last day.
  select string_agg(distinct so.order_number, ', ') into v_late
  from quotation_items q
  join customer_order_items s on s.id = q.carried_from_item_id
  join customer_orders so on so.id = s.customer_order_id
  cross join lateral public.rush_waiting_clock(so.id) c
  where q.quotation_id = v_quotation.id
    and s.given_to_dmc_at is null
    and c.deadline < (now() at time zone 'Asia/Manila')::date;

  if v_late is not null then
    raise exception 'The 2 weeks for the goods waiting from % are over, so they are DMC''s now and this quotation can''t be approved. DMC prices your request again without them.', v_late;
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


-- 4. Reminders, and the end of the 2 weeks, run by the server every 5 minutes -------------
-- As in 040, except:
--   when the 2 weeks start         -> the customer and sales are told the last day
--   a week before the last day     -> reminder
--   2 days before the last day     -> reminder
--   the day after the last day     -> the goods are DMC's, whatever request or
--                                     quotation of the customer's is still open:
--                                     a waiting quotation with them is withdrawn
--                                     and its request priced again without them;
--                                     a request for them alone is cancelled once
--                                     the customer has no goods waiting.
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
  v_quote       record;
  v_lines       jsonb;
  v_list        text;
  v_deadline    date;
  v_kind        text;
  v_racks       text;
  v_new         integer;
  v_withdrawn   text;
  v_withdrawn_n integer;
  v_cancelled   text;
  v_to_customer text;
  v_to_sales    text;
  v_reminders   jsonb := '[]'::jsonb;
  v_given       jsonb := '[]'::jsonb;
  v_requests    jsonb := '[]'::jsonb;
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

    -- v_deadline is the last day: the goods are DMC's from the day after.
    v_kind := case
      when v_today > v_deadline then 'given'
      when v_today >= v_deadline - 2 then 'days'
      when v_today >= v_deadline - 7 then 'week'
      else 'start'
    end;

    if v_kind <> 'given' and exists (
      select 1 from waiting_goods_notices n
      where n.customer_order_id = v_order.id and n.kind = v_kind and n.deadline = v_deadline
    ) then
      continue;
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

      -- A quotation still waiting for the customer's answer with these goods in
      -- it can't be approved any more: it's withdrawn (kept on record), and its
      -- request goes back to DMC to be priced again without them.
      v_withdrawn := null;
      v_withdrawn_n := 0;
      for v_quote in
        select q.id, q.quotation_number, r.id as request_id, r.quotation_reference
        from quotations q
        join quotation_requests r on r.id = q.quotation_request_id
        where lower(trim(q.status)) = 'pending approval'
          and exists (
            select 1 from quotation_items qi
            where qi.quotation_id = q.id
              and qi.carried_from_item_id in (select (e ->> 'item')::uuid from jsonb_array_elements(v_lines) e)
          )
        order by q.quotation_number
      loop
        update quotations set status = 'withdrawn' where id = v_quote.id;
        update quotation_requests set status = 'awaiting pricing'
        where id = v_quote.request_id
          and lower(trim(status)) = 'priced & sent to customer';
        v_withdrawn := concat_ws(', ', v_withdrawn, format('%s (%s)', v_quote.quotation_number, v_quote.quotation_reference));
        v_withdrawn_n := v_withdrawn_n + 1;
      end loop;

      -- A request for waiting goods alone (no products of its own) has nothing
      -- left to price once the customer has no goods waiting: it's cancelled,
      -- and stays on record.
      v_cancelled := null;
      if not exists (
        select 1
        from customer_order_items i
        join customer_orders o on o.id = i.customer_order_id
        join order_rush_agreements a on a.customer_order_id = o.id
        where o.customer_id = v_order.customer_id
          and coalesce(lower(trim(o.status)), '') <> 'cancelled'
          and i.ship_quantity is not null
          and i.quantity > i.ship_quantity
          and i.given_to_dmc_at is null
          and not exists (select 1 from customer_order_items c where c.carried_from_item_id = i.id)
      ) then
        with gone as (
          update quotation_requests r
          set status = 'cancelled'
          where r.customer_id = v_order.customer_id
            and lower(trim(r.status)) = 'awaiting pricing'
            and not exists (select 1 from quotation_request_items it where it.quotation_request_id = r.id)
          returning r.quotation_reference
        )
        select string_agg(quotation_reference, ', ' order by quotation_reference) into v_cancelled from gone;
      end if;

      v_to_customer := concat_ws(' ',
        case
          when v_withdrawn_n = 1 then format('Your quotation %s had them in it, so it can''t be approved now: DMC prices that request again without them.', v_withdrawn)
          when v_withdrawn_n > 1 then format('Your quotations %s had them in them, so they can''t be approved now: DMC prices those requests again without them.', v_withdrawn)
        end,
        case when v_cancelled is not null then format('Your request %s, for them alone, is cancelled.', v_cancelled) end);
      v_to_sales := concat_ws(' ',
        case when v_withdrawn is not null then format('Withdrawn: %s. Price the request again without them.', v_withdrawn) end,
        case when v_cancelled is not null then format('Cancelled (it was for them alone): %s.', v_cancelled) end);

      begin
        insert into notifications (user_id, role, title, message, type, link, related_customer_order_id)
        values
          (v_order.customer_id, 'customer',
           format('%s - Waiting goods are DMC''s now', v_order.order_number),
           concat_ws(' ',
             format('The 2 weeks for your goods from %s (%s) ended on %s without an approved order taking them. As agreed in your rush shipment, DMC may now do what it wants with them.',
               v_order.order_number, v_list, to_char(v_deadline, c_day)),
             nullif(v_to_customer, '')),
           'warning', '/my-orders', v_order.id),
          (v_order.customer_id, 'sales',
           format('%s - Waiting goods: 2 weeks over', v_order.order_number),
           concat_ws(' ',
             format('%s''s waiting goods (%s) had no approved order by %s, the end of their 2 weeks, so they are DMC''s now. The warehouse was told to clear them.',
               v_order.order_number, v_list, to_char(v_deadline, c_day)),
             nullif(v_to_sales, '')),
           'info', '/customer-orders', v_order.id),
          (v_order.customer_id, 'warehouse',
           format('%s - Clear its waiting goods (DMC''s now)', v_order.order_number),
           format('%s''s waiting goods had no approved order within their 2 weeks and are DMC''s now: %s.%s Their racks are free in the system.',
             v_order.order_number, v_list, coalesce(format(' On racks %s.', v_racks), '')),
           'info', '/warehouse-holdings', v_order.id);
      exception when foreign_key_violation then
        null;  -- the customer's sign-in no longer exists: nobody to tell
      end;

      v_given := v_given || to_jsonb(v_order.order_number);
      if v_withdrawn is not null or v_cancelled is not null then
        v_requests := v_requests || jsonb_build_object('order', v_order.order_number, 'withdrawn', v_withdrawn, 'cancelled', v_cancelled);
      end if;
    else
      begin
        insert into notifications (user_id, role, title, message, type, link, related_customer_order_id)
        values
          (v_order.customer_id, 'customer',
           case v_kind
             when 'start' then format('%s - Your waiting goods are in: approve your next order by %s', v_order.order_number, to_char(v_deadline, c_day))
             else format('%s - Approve your next order by %s', v_order.order_number, to_char(v_deadline, c_day))
           end,
           case v_kind
             when 'start' then format('All your goods from %s (%s) are in DMC''s warehouse, waiting for your next order. That order must be confirmed, its quotation approved, by %s: send a quotation request soon, with other products or with only these, so DMC can price it in time. That order''s container and shipping are yours to pay. After %s, as you agreed, DMC may do what it wants with them.',
               v_order.order_number, v_list, to_char(v_deadline, c_day), to_char(v_deadline, c_day))
             else format('Your goods from %s (%s) are waiting in DMC''s warehouse for your next order. Approve that order''s quotation by %s (%s left); if you haven''t sent a quotation request yet, send it now, with other products or with only these. After %s, as you agreed, DMC may do what it wants with them.',
               v_order.order_number, v_list, to_char(v_deadline, c_day), case v_kind when 'week' then 'a week' else '2 days' end, to_char(v_deadline, c_day))
           end,
           'warning', '/quotation-requests', v_order.id),
          (v_order.customer_id, 'sales',
           format('%s - Waiting goods: %s', v_order.order_number,
             case v_kind when 'start' then '2 weeks start' when 'week' then 'a week left' else '2 days left' end),
           format('%s''s waiting goods (%s) need the customer''s next order approved by %s, or they become DMC''s. Price their requests promptly.',
             v_order.order_number, v_list, to_char(v_deadline, c_day)),
           'info', '/customer-orders', v_order.id);
      exception when foreign_key_violation then
        null;
      end;

      v_reminders := v_reminders || jsonb_build_object('order', v_order.order_number, 'kind', v_kind);
    end if;
  end loop;

  return jsonb_build_object('reminders', v_reminders, 'given', v_given, 'requests_changed', v_requests, 'dry_run', p_dry_run);
end;
$$;

revoke execute on function public.apply_waiting_goods_deadlines(date, boolean) from public, anon, authenticated;
grant execute on function public.apply_waiting_goods_deadlines(date, boolean) to service_role;


-- 5. The words a customer agrees to, for new rush shipments ----------------------------------
-- As in 039, point 2 saying 2 weeks and that the next order must be approved
-- within them. Agreements already made keep the words they were made with.
create or replace function public.rush_terms(p_order_number text)
returns text
language sql
immutable
as $$
  select format(
'Rush shipment for %1$s

1. Only the goods under "Ships now" go in this order''s container. They are labeled, loaded and shipped as soon as they''re ready.
2. The goods under "Waits for your next order" are not shipped now. When they arrive, DMC keeps them and puts them in the container of your next order with DMC: with other products, or with only these goods. Either way, that order''s container and shipping are yours to pay, as for any order. That next order must be confirmed, its quotation approved, within 2 weeks of the day they are all in DMC''s warehouse and this order''s container has left, so send its quotation request early. After that, you give DMC the right to do what it wants with them, to free its storage.
3. %1$s''s price and balance stay the same. The waiting goods are already part of %1$s, so they are not charged again on your next order. Your next order''s container is chosen to fit them too, which can make it a bigger container.
4. Once you agree, this can''t be undone.', p_order_number)
$$;


-- Check: true, true, true, true, then how many rush agreements are on record
-- (0 on Nov 21, 2026; any there are now count their goods' 2 weeks too).
select
  (select pg_get_constraintdef(c.oid) like '%start%'
   from pg_constraint c
   where c.conname = 'waiting_goods_notices_kind_check') as reminders_at_start,
  position('+ 14' in pg_get_functiondef('public.rush_waiting_clock(uuid)'::regprocedure)) > 0 as two_week_clock,
  position('v_today > v_deadline' in pg_get_functiondef('public.apply_waiting_goods_deadlines(date, boolean)'::regprocedure)) > 0 as last_day_is_the_last,
  position('within 2 weeks' in public.rush_terms('ORD-X')) > 0 as agreement_says_2_weeks,
  (select count(*) from public.order_rush_agreements) as rush_agreements_on_record;
