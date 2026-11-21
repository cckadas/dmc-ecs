-- =============================================================================
-- 040: Credit limit: a quotation that would take the customer over it is held
--
-- Until now the credit check only looked at what a customer already owed: at
-- ₱1.4M of a ₱1.5M limit, a quotation of any size could still be sent and
-- approved. As DMC decided:
--   - when sales prices a request whose total would take the customer over
--     the limit if approved, it can't be sent: sales puts it on hold instead.
--     The customer sees it's on hold until they pay their open orders, and no
--     prices or other details of it (there's nothing priced to show);
--   - nothing is fixed while it's on hold: whenever it's opened, and when it's
--     finally sent, it's priced from the price list as it is then;
--   - sales is told when the customer's balance goes down (a payment verified,
--     an order cancelled) or the limit is raised, to open it again and send it
--     once its total fits;
--   - approving a quotation counts the new order too: refused if it would take
--     the balance over the limit, saying how much to pay first;
--   - a held request doesn't keep a rush shipment's waiting goods from
--     becoming DMC's after their 6 months (039): that wait is the customer's.
-- Every new order is checked, as before (the made-up history loader turns the
-- check off while it loads past orders). Safe to run more than once. The last
-- query shows true, true, true, true.
-- =============================================================================


-- 1. A request on hold, and who put it there ----------------------------------------------
alter table public.quotation_requests
  add column if not exists credit_hold_at timestamptz,
  add column if not exists credit_hold_by uuid,
  add column if not exists credit_hold_by_name text;


-- 2. Putting a request on hold (sales or admin) --------------------------------------------
-- From the PFI Builder, when its total would take the customer over the limit.
create or replace function public.hold_request_for_credit(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request  quotation_requests%rowtype;
  v_limit    numeric;
  v_owed     numeric;
  v_name     text;
  v_label    text;
  c_money    constant text := 'FM999,999,999,990.00';
begin
  if not public.has_role('admin', 'sales') then
    raise exception 'Only sales or admin can put a request on hold.';
  end if;

  select * into v_request from quotation_requests where id = p_request_id for update;

  if v_request.id is null then
    raise exception 'This request no longer exists.';
  end if;

  if coalesce(lower(trim(v_request.status)), '') <> 'awaiting pricing' then
    raise exception '% isn''t waiting for pricing any more (it is "%"). Open it again.', v_request.quotation_reference, v_request.status;
  end if;

  select value into v_limit from business_settings where key = 'credit_limit';
  if v_limit is null then
    raise exception 'No credit limit is set, so there''s nothing to hold it for.';
  end if;

  if v_request.credit_hold_at is not null then
    return jsonb_build_object('reference', v_request.quotation_reference, 'held', true, 'already', true);
  end if;

  select name into v_name from profiles where id = auth.uid();

  update quotation_requests
  set credit_hold_at = now(),
      credit_hold_by = auth.uid(),
      credit_hold_by_name = v_name
  where id = p_request_id;

  v_owed := customer_outstanding_balance(v_request.customer_id);
  select coalesce(nullif(trim(company), ''), name) into v_label from profiles where id = v_request.customer_id;

  begin
    insert into notifications (user_id, role, title, message, type, link)
    values
      (v_request.customer_id, 'customer',
       format('%s - On hold until you pay', v_request.quotation_reference),
       format('DMC can''t send its prices for %s yet: approving it would take your unpaid balance over your credit limit of ₱%s. Pay your open orders on the Payments page, and DMC sends the prices once there''s room.',
         v_request.quotation_reference, to_char(v_limit, c_money)),
       'warning', '/payments'),
      (v_request.customer_id, 'sales',
       format('%s - On hold (credit limit)', v_request.quotation_reference),
       format('%s put %s on hold: %s owes ₱%s of the ₱%s credit limit. You''ll be told when their balance goes down.',
         coalesce(v_name, 'Sales'), v_request.quotation_reference, coalesce(v_label, 'the customer'), to_char(v_owed, c_money), to_char(v_limit, c_money)),
       'info', '/pfi-builder');
  exception when foreign_key_violation then
    null;
  end;

  return jsonb_build_object('reference', v_request.quotation_reference, 'held', true, 'already', false);
end;
$$;

revoke execute on function public.hold_request_for_credit(uuid) from public, anon;
grant execute on function public.hold_request_for_credit(uuid) to authenticated;


-- 3. Sending a quotation: only if it fits ---------------------------------------------------
-- Named to run after quotations_charges (016), which works out its total.
create or replace function public.refuse_quotation_over_credit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit      numeric;
  v_customer   uuid;
  v_reference  text;
  v_owed       numeric;
  v_label      text;
  c_money      constant text := 'FM999,999,999,990.00';
begin
  if auth.uid() is null or coalesce(lower(trim(new.status)), '') <> 'pending approval' then
    return new;
  end if;

  select value into v_limit from business_settings where key = 'credit_limit';
  if v_limit is null then
    return new;
  end if;

  select r.customer_id, r.quotation_reference into v_customer, v_reference
  from quotation_requests r
  where r.id = new.quotation_request_id;

  v_owed := customer_outstanding_balance(v_customer);

  if v_owed + coalesce(new.total_amount, 0) > v_limit then
    select coalesce(nullif(trim(company), ''), name) into v_label from profiles where id = v_customer;
    raise exception 'This quotation (₱%) would take % over the credit limit if they approve it: they owe ₱% of ₱%. It can''t be sent: put % on hold until they pay.',
      to_char(coalesce(new.total_amount, 0), c_money), coalesce(v_label, 'the customer'),
      to_char(v_owed, c_money), to_char(v_limit, c_money), v_reference;
  end if;

  -- Sent: whatever hold it had is over.
  update quotation_requests
  set credit_hold_at = null, credit_hold_by = null, credit_hold_by_name = null
  where id = new.quotation_request_id
    and credit_hold_at is not null;

  return new;
end;
$$;

revoke execute on function public.refuse_quotation_over_credit() from public, anon, authenticated;

drop trigger if exists quotations_credit_room on public.quotations;
create trigger quotations_credit_room
  before insert on public.quotations
  for each row execute function public.refuse_quotation_over_credit();


-- 4. Approving a quotation counts the new order too -----------------------------------------
-- In place of 002's check on new orders (it looked only at what was owed
-- before). New requests keep 002's check: they have no price yet.
create or replace function public.enforce_credit_limit_on_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit  numeric;
  v_owed   numeric;
  v_after  numeric;
  c_money  constant text := 'FM999,999,999,990.00';
begin
  select value into v_limit from business_settings where key = 'credit_limit';
  if v_limit is null then
    return new;
  end if;

  -- One approval at a time per customer, so two can't both squeeze in.
  perform 1 from profiles where id = new.customer_id for update;

  v_owed := customer_outstanding_balance(new.customer_id);
  v_after := v_owed + coalesce(new.total_amount, 0);

  if v_after > v_limit then
    raise exception 'Approving this would bring your unpaid balance to ₱%, over your credit limit of ₱%. Pay at least ₱% of your open orders first, then approve it%.',
      to_char(v_after, c_money), to_char(v_limit, c_money), to_char(v_after - v_limit, c_money),
      coalesce(' (it can be approved until ' || to_char(new.expiry_date, 'FMMon FMDD, YYYY') || ')', '');
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_credit_limit_on_order() from public, anon, authenticated;

drop trigger if exists customer_orders_credit_limit on public.customer_orders;
create trigger customer_orders_credit_limit
  before insert on public.customer_orders
  for each row execute function public.enforce_credit_limit_on_order();


-- 5. Telling sales when there may be room now ------------------------------------------------
-- A payment verified, or an order cancelled, for a customer with requests on hold.
create or replace function public.tell_sales_credit_room()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refs   text;
  v_limit  numeric;
  v_owed   numeric;
  v_label  text;
  c_money  constant text := 'FM999,999,999,990.00';
begin
  if not (coalesce(new.settled_amount, 0) > coalesce(old.settled_amount, 0)
          or (coalesce(lower(trim(new.status)), '') = 'cancelled' and coalesce(lower(trim(old.status)), '') <> 'cancelled')) then
    return null;
  end if;

  select string_agg(r.quotation_reference, ', ' order by r.created_at) into v_refs
  from quotation_requests r
  where r.customer_id = new.customer_id
    and r.credit_hold_at is not null
    and coalesce(lower(trim(r.status)), '') = 'awaiting pricing';

  if v_refs is null then
    return null;
  end if;

  select value into v_limit from business_settings where key = 'credit_limit';
  v_owed := customer_outstanding_balance(new.customer_id);
  select coalesce(nullif(trim(company), ''), name) into v_label from profiles where id = new.customer_id;

  begin
    insert into notifications (user_id, role, title, message, type, link)
    values (new.customer_id, 'sales',
      format('%s - Balance went down: %s on hold', coalesce(v_label, 'A customer'), v_refs),
      format('%s now owes ₱%s%s. Open %s in the PFI Builder: send it if its total fits now.',
        coalesce(v_label, 'The customer'), to_char(v_owed, c_money),
        case when v_limit is not null
          then format(' of the ₱%s credit limit (room ₱%s)', to_char(v_limit, c_money), to_char(greatest(v_limit - v_owed, 0), c_money))
          else '' end,
        v_refs),
      'info', '/pfi-builder');
  exception when foreign_key_violation then
    null;
  end;

  return null;
end;
$$;

revoke execute on function public.tell_sales_credit_room() from public, anon, authenticated;

drop trigger if exists customer_orders_credit_room on public.customer_orders;
create trigger customer_orders_credit_room
  after update of settled_amount, status on public.customer_orders
  for each row execute function public.tell_sales_credit_room();

-- The limit raised (or turned off).
create or replace function public.tell_sales_limit_raised()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    record;
  c_money  constant text := 'FM999,999,999,990.00';
begin
  if new.key <> 'credit_limit'
     or not (new.value is null or (old.value is not null and new.value > old.value)) then
    return null;
  end if;

  for v_row in
    select r.customer_id, string_agg(r.quotation_reference, ', ' order by r.created_at) as refs
    from quotation_requests r
    where r.credit_hold_at is not null
      and coalesce(lower(trim(r.status)), '') = 'awaiting pricing'
    group by r.customer_id
  loop
    begin
      insert into notifications (user_id, role, title, message, type, link)
      values (v_row.customer_id, 'sales',
        format('Credit limit raised: %s on hold', v_row.refs),
        format('The credit limit is now %s. Open %s in the PFI Builder: send it if its total fits now.',
          case when new.value is null then 'off' else '₱' || to_char(new.value, c_money) end, v_row.refs),
        'info', '/pfi-builder');
    exception when foreign_key_violation then
      null;
    end;
  end loop;

  return null;
end;
$$;

revoke execute on function public.tell_sales_limit_raised() from public, anon, authenticated;

drop trigger if exists business_settings_limit_raised on public.business_settings;
create trigger business_settings_limit_raised
  after update on public.business_settings
  for each row execute function public.tell_sales_limit_raised();


-- 6. A held request doesn't hold a rush shipment's waiting goods ---------------------------
-- As in 039, but a request on hold for the customer's debt isn't "open" for
-- the 6 months: that wait is the customer's, not DMC's pricing time.
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
          and r.credit_hold_at is null
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


-- Check: true, true, true, true.
select
  to_regprocedure('public.hold_request_for_credit(uuid)') is not null as hold_step,
  exists (select 1 from pg_trigger where tgname = 'quotations_credit_room') as quotation_must_fit,
  exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
          where t.tgname = 'customer_orders_credit_limit' and p.proname = 'enforce_credit_limit_on_order') as approval_counts_new_order,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'quotation_requests' and column_name = 'credit_hold_at') as hold_recorded;
