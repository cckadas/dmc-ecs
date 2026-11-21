-- =============================================================================
-- 038: Closing a customer's account: stop new orders, deactivate, then delete
--
-- Until now the Customers page deleted a customer's profile directly. A
-- customer with requests was refused with database text; one whose orders were
-- loaded without requests (the made-up customers) was deleted, leaving every
-- order with no customer and no delivery location. Now admin closes an account
-- in steps on the Customers page, through the server (which also blocks or
-- removes the sign-in):
--   1. Stop new orders. The customer can still sign in, pay what they owe,
--      handle labels and follow their orders, but can't send requests, approve
--      quotations, ask for a new quote or start a rush shipment. Confirmed
--      orders with nothing paid are cancelled, requests waiting for a price are
--      cancelled and quotations waiting for an answer are withdrawn (all kept
--      on record). Orders with a down payment carry on to the end.
--   2. Deactivate, once nothing is running and nothing is left to pay. The
--      customer can't sign in; every record stays. "Activate" undoes 1 or 2.
--   3. Delete, once deactivated. A customer with no records at all is deleted.
--      One with records is erased: their sign-in, name, email, phone and
--      addresses go; their orders, quotations, PFIs and payments stay, under
--      "Deleted customer", each with its delivery country.
-- Only admin. Every step is recorded: who, when, and what it cancelled.
--
-- Also:
--   - nobody deletes a customer's profile directly any more, and an order
--     can't be left without its customer;
--   - a profile no longer disappears when its sign-in is deleted, so an erased
--     customer's records keep their customer;
--   - only these steps change whether a customer's account is open.
-- Run after 037. Safe to run more than once. The last query shows true, true,
-- true, 0.
-- =============================================================================


-- 1. Where each account stands ------------------------------------------------------------
--   active          (none of these set)
--   no new orders   new_orders_stopped_at
--   deactivated     is_active = false (since 013 that already takes away every
--                   permission; deactivated_at says when)
--   deleted         erased_at: the person is gone, their records stay
alter table public.profiles
  add column if not exists new_orders_stopped_at timestamptz,
  add column if not exists deactivated_at timestamptz,
  add column if not exists erased_at timestamptz;


-- 2. The record of each step -----------------------------------------------------------------
create table if not exists public.customer_account_changes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  action text not null check (action in ('stopped new orders', 'deactivated', 'activated', 'erased', 'deleted')),
  done_by uuid,
  done_by_name text,
  done_at timestamptz not null default now(),
  cancelled_orders text[] not null default '{}',
  cancelled_requests text[] not null default '{}',
  withdrawn_quotations text[] not null default '{}'
);

alter table public.customer_account_changes enable row level security;
revoke insert, update, delete on public.customer_account_changes from anon, authenticated;

drop policy if exists "staff: read customer account changes" on public.customer_account_changes;
create policy "staff: read customer account changes" on public.customer_account_changes
  for select to authenticated
  using ((select public.has_role('admin', 'sales', 'management')));


-- 3. Each of a customer's orders, by what closing the account does with it ------------------
--   unpaid          confirmed, nothing paid or sent: it can be cancelled
--   payment check   a payment sent and waiting for sales' check
--   running         a down payment in: it has to finish first
--   balance         shipped, with money still to pay
--   done            shipped and paid
--   cancelled
create or replace function public.customer_order_kinds(p_customer uuid)
returns table (order_id uuid, order_number text, status text, kind text, balance numeric)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.order_number, o.status,
    case
      when x.s = 'cancelled' then 'cancelled'
      when coalesce(o.pending_payment_amount, 0) > 0 or x.s = 'submitted' then 'payment check'
      when x.s in ('pending payment', 'payment rejected') and coalesce(o.settled_amount, 0) <= 0 then 'unpaid'
      when x.s = 'shipped' and coalesce(o.total_amount, 0) - coalesce(o.settled_amount, 0) > 0.009 then 'balance'
      when x.s = 'shipped' then 'done'
      else 'running'
    end,
    greatest(coalesce(o.total_amount, 0) - coalesce(o.settled_amount, 0), 0)
  from customer_orders o
  cross join lateral (select coalesce(lower(trim(o.status)), '') as s) x
  where o.customer_id = p_customer
$$;

revoke execute on function public.customer_order_kinds(uuid) from public, anon, authenticated;


-- 4. The steps -------------------------------------------------------------------------------
-- Called by the server for an admin (server/routes/customerAccounts.js):
--   p_action   'stop', 'deactivate', 'activate' or 'delete'
--   p_dry_run  true: only says what the step would do, or why it can't
-- The server blocks the sign-in after "deactivate", opens it after
-- "activate", and removes it before "delete".
create or replace function public.customer_account_step(
  p_customer uuid,
  p_action   text,
  p_admin    uuid,
  p_dry_run  boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action         text := lower(trim(coalesce(p_action, '')));
  v_customer       profiles%rowtype;
  v_admin_name     text;
  v_status         text;
  v_label          text;
  v_refusal        text;
  v_result         text;
  v_cancel_orders  jsonb;
  v_cancel_reqs    jsonb;
  v_withdraw       jsonb;
  v_carry_on       jsonb;
  v_checks         jsonb;
  v_balances       jsonb;
  v_waiting        jsonb;
  v_records        jsonb;
  v_has_records    boolean;
  v_order          record;
  v_quotation      text;
  v_request_id     uuid;
  v_reason         text;
  v_orders_done    text[] := '{}';
  v_requests_done  text[] := '{}';
  v_quotes_done    text[] := '{}';
  v_ongoing_text   text;
begin
  if v_action not in ('stop', 'deactivate', 'activate', 'delete') then
    raise exception 'Unknown step "%".', p_action;
  end if;

  select name into v_admin_name
  from profiles
  where id = p_admin and lower(trim(role)) = 'admin' and coalesce(is_active, true);

  if v_admin_name is null then
    raise exception 'Only an admin can change a customer''s account.';
  end if;

  select * into v_customer from profiles where id = p_customer for update;

  if v_customer.id is null or coalesce(lower(trim(v_customer.role)), '') <> 'customer' then
    raise exception 'Customer not found.';
  end if;

  -- The customer's quotations, requests and orders, in the order approving
  -- a quotation locks them, so nothing changes under this step.
  perform 1
  from quotations q
  join quotation_requests r on r.id = q.quotation_request_id
  where r.customer_id = p_customer
  order by q.id
  for update of q;
  perform 1 from quotation_requests where customer_id = p_customer order by id for update;
  perform 1 from customer_orders where customer_id = p_customer order by id for update;

  v_status := case
    when v_customer.erased_at is not null then 'deleted'
    when not coalesce(v_customer.is_active, true) then 'deactivated'
    when v_customer.new_orders_stopped_at is not null then 'no new orders'
    else 'active'
  end;
  v_label := coalesce(nullif(trim(v_customer.company), ''), v_customer.name);

  -- What there is ------------------------------------------------------------------
  select
    coalesce(jsonb_agg(jsonb_build_object('number', k.order_number, 'status', k.status) order by k.order_number) filter (where k.kind = 'unpaid'), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('number', k.order_number, 'status', k.status) order by k.order_number) filter (where k.kind = 'running'), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('number', k.order_number, 'status', k.status) order by k.order_number) filter (where k.kind = 'payment check'), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('number', k.order_number, 'amount', k.balance) order by k.order_number) filter (where k.kind = 'balance'), '[]'::jsonb)
  into v_cancel_orders, v_carry_on, v_checks, v_balances
  from public.customer_order_kinds(p_customer) k;

  select coalesce(jsonb_agg(r.quotation_reference order by r.created_at), '[]'::jsonb)
  into v_cancel_reqs
  from quotation_requests r
  where r.customer_id = p_customer
    and coalesce(lower(trim(r.status)), '') = 'awaiting pricing';

  select coalesce(jsonb_agg(jsonb_build_object('number', q.quotation_number, 'request', r.quotation_reference) order by q.created_at), '[]'::jsonb)
  into v_withdraw
  from quotations q
  join quotation_requests r on r.id = q.quotation_request_id
  where r.customer_id = p_customer
    and coalesce(lower(trim(q.status)), '') = 'pending approval';

  -- Goods a rush shipment left waiting for the customer's next order, with no
  -- next order to go with once the unpaid orders are cancelled (cancelling an
  -- order that carried them puts them back to waiting: 034).
  select coalesce(jsonb_agg(distinct o.order_number), '[]'::jsonb)
  into v_waiting
  from customer_order_items i
  join customer_orders o on o.id = i.customer_order_id
  where o.customer_id = p_customer
    and coalesce(lower(trim(o.status)), '') <> 'cancelled'
    and i.ship_quantity is not null
    and i.quantity > i.ship_quantity
    and not public.item_waiting_gone(i.id)
    and not exists (
      select 1
      from customer_order_items c
      join public.customer_order_kinds(p_customer) k on k.order_id = c.customer_order_id
      where c.carried_from_item_id = i.id
        and k.kind not in ('cancelled', 'unpaid')
    );

  select jsonb_build_object(
    'orders', (select count(*) from customer_orders where customer_id = p_customer),
    'requests', (select count(*) from quotation_requests where customer_id = p_customer),
    'quotations', (select count(*) from quotations q join quotation_requests r on r.id = q.quotation_request_id where r.customer_id = p_customer)
  ) into v_records;
  v_has_records := (v_records ->> 'orders')::integer + (v_records ->> 'requests')::integer > 0;

  v_ongoing_text := concat_ws(' ',
    case when jsonb_array_length(v_carry_on) > 0 then format('Orders with a down payment have to finish first: %s.',
      (select string_agg(format('%s (%s)', e ->> 'number', e ->> 'status'), ', ') from jsonb_array_elements(v_carry_on) e)) end,
    case when jsonb_array_length(v_checks) > 0 then format('A payment is waiting for sales'' check: %s.',
      (select string_agg(e ->> 'number', ', ') from jsonb_array_elements(v_checks) e)) end,
    case when jsonb_array_length(v_balances) > 0 then format('Still to pay: %s.',
      (select string_agg(format('%s (₱ %s)', e ->> 'number', to_char((e ->> 'amount')::numeric, 'FM999,999,999,990.00')), ', ') from jsonb_array_elements(v_balances) e)) end);

  -- Whether the step can be done ------------------------------------------------------
  if v_status = 'deleted' then
    v_refusal := 'This customer was deleted.';
  elsif v_action = 'stop' then
    if v_status = 'no new orders' then
      v_refusal := format('New orders are already stopped for %s.', v_label);
    elsif v_status = 'deactivated' then
      v_refusal := format('%s is deactivated already.', v_label);
    elsif jsonb_array_length(v_waiting) > 0 then
      v_refusal := format('%s has goods from a rush shipment waiting to go with their next order (from %s). Stop new orders once that next order is placed and paid: the goods go with it.',
        v_label, (select string_agg(value, ', ') from jsonb_array_elements_text(v_waiting)));
    end if;
  elsif v_action = 'deactivate' then
    if v_status = 'deactivated' then
      v_refusal := format('%s is deactivated already.', v_label);
    elsif v_ongoing_text <> '' then
      v_refusal := concat_ws(' ', format('%s can''t be deactivated yet.', v_label), v_ongoing_text,
        case when v_status = 'active' then 'Meanwhile, you can stop their new orders.' end);
    end if;
  elsif v_action = 'activate' then
    if v_status = 'active' then
      v_refusal := format('%s''s account is open already.', v_label);
    end if;
  elsif v_action = 'delete' then
    if v_status <> 'deactivated' then
      v_refusal := format('Deactivate %s first: a customer is deleted after deactivating.', v_label);
    elsif v_ongoing_text <> '' or jsonb_array_length(v_cancel_orders) + jsonb_array_length(v_cancel_reqs) + jsonb_array_length(v_withdraw) > 0 then
      v_refusal := format('%s still has orders or quotations open, so they can''t be deleted. Activate them to finish those first.', v_label);
    end if;
  end if;

  if v_refusal is null and not coalesce(p_dry_run, true) then

    -- Stop new orders / deactivate --------------------------------------------------
    if v_action in ('stop', 'deactivate') then
      v_reason := case v_action
        when 'stop' then 'DMC stopped new orders on this account before its down payment was paid.'
        else 'DMC closed this account before its down payment was paid.'
      end;

      -- Confirmed orders with nothing paid: cancelled as 028 cancels them.
      for v_order in
        select o.*
        from customer_orders o
        join public.customer_order_kinds(p_customer) k on k.order_id = o.id
        where k.kind = 'unpaid'
        order by o.order_number
      loop
        update customer_orders
        set status = 'cancelled',
            cancelled_at = now(),
            cancellation_reason = v_reason
        where id = v_order.id;

        insert into customer_order_status_history (customer_order_id, previous_status, new_status, changed_at)
        values (v_order.id, v_order.status, 'cancelled', now());

        v_quotation := null;
        v_request_id := null;
        update quotations
        set status = 'cancelled'
        where id = v_order.quotation_id
           or (v_order.quotation_id is null and quotation_number = v_order.quotation_number)
        returning quotation_number, quotation_request_id into v_quotation, v_request_id;

        if v_request_id is not null then
          update quotation_requests set status = 'cancelled' where id = v_request_id;
        end if;

        v_orders_done := v_orders_done || v_order.order_number;
      end loop;

      -- Quotations waiting for an answer: withdrawn, their requests cancelled.
      with withdrawn as (
        update quotations q
        set status = 'withdrawn'
        from quotation_requests r
        where r.id = q.quotation_request_id
          and r.customer_id = p_customer
          and coalesce(lower(trim(q.status)), '') = 'pending approval'
        returning q.quotation_number, q.quotation_request_id
      ), closed as (
        update quotation_requests
        set status = 'cancelled'
        where id in (select quotation_request_id from withdrawn)
        returning id
      )
      select coalesce(array_agg(w.quotation_number order by w.quotation_number), '{}')
      into v_quotes_done
      from withdrawn w;

      -- Requests waiting for a price: cancelled.
      with cancelled as (
        update quotation_requests
        set status = 'cancelled'
        where customer_id = p_customer
          and coalesce(lower(trim(status)), '') = 'awaiting pricing'
        returning quotation_reference
      )
      select coalesce(array_agg(c.quotation_reference order by c.quotation_reference), '{}')
      into v_requests_done
      from cancelled c;

      if v_action = 'stop' then
        update profiles set new_orders_stopped_at = now() where id = p_customer;
        v_result := 'stopped';
      else
        update profiles
        set is_active = false,
            deactivated_at = now(),
            new_orders_stopped_at = coalesce(new_orders_stopped_at, now())
        where id = p_customer;
        v_result := 'deactivated';
      end if;

      insert into customer_account_changes
        (customer_id, action, done_by, done_by_name, cancelled_orders, cancelled_requests, withdrawn_quotations)
      values
        (p_customer, case v_action when 'stop' then 'stopped new orders' else 'deactivated' end,
         p_admin, v_admin_name, v_orders_done, v_requests_done, v_quotes_done);

      begin
        if v_action = 'stop' then
          insert into notifications (user_id, role, title, message, type, link)
          values (p_customer, 'customer', 'New orders stopped on your account',
            concat_ws(' ',
              'DMC has stopped new orders on your account. You can still sign in, pay what you owe and follow your orders until they''re done.',
              case when cardinality(v_orders_done) > 0 then format('Cancelled, as nothing was paid yet: %s.', array_to_string(v_orders_done, ', ')) end,
              case when cardinality(v_quotes_done) > 0 then format('Quotations withdrawn: %s.', array_to_string(v_quotes_done, ', ')) end,
              case when cardinality(v_requests_done) > 0 then format('Requests cancelled: %s.', array_to_string(v_requests_done, ', ')) end,
              'Please contact DMC about new orders.'),
            'warning', '/my-orders');
        end if;

        insert into notifications (user_id, role, title, message, type, link)
        values (p_customer, 'sales',
          format('%s - %s', v_label, case v_action when 'stop' then 'New orders stopped' else 'Deactivated' end),
          concat_ws(' ',
            format('%s %s %s.', v_admin_name, case v_action when 'stop' then 'stopped new orders for' else 'deactivated' end, v_label),
            case when cardinality(v_orders_done) > 0 then format('Cancelled, as nothing was paid yet: %s.', array_to_string(v_orders_done, ', ')) end,
            case when cardinality(v_quotes_done) > 0 then format('Quotations withdrawn: %s.', array_to_string(v_quotes_done, ', ')) end,
            case when cardinality(v_requests_done) > 0 then format('Requests cancelled: %s.', array_to_string(v_requests_done, ', ')) end,
            case when v_action = 'stop' and v_ongoing_text <> '' then
              'Carrying on to the end: ' || (select string_agg(e ->> 'number', ', ') from jsonb_array_elements(v_carry_on || v_checks || v_balances) e) || '.' end),
          'info', '/customers');
      exception when foreign_key_violation then
        null;  -- the sign-in no longer exists: nobody to tell
      end;

    -- Activate ------------------------------------------------------------------------
    elsif v_action = 'activate' then
      update profiles
      set is_active = true,
          new_orders_stopped_at = null,
          deactivated_at = null
      where id = p_customer;

      insert into customer_account_changes (customer_id, action, done_by, done_by_name)
      values (p_customer, 'activated', p_admin, v_admin_name);

      begin
        insert into notifications (user_id, role, title, message, type, link)
        values
          (p_customer, 'customer', 'Your account is open again',
           'DMC has opened your account again: you can send quotation requests and place orders.',
           'info', '/quotation-requests'),
          (p_customer, 'sales', format('%s - Account open again', v_label),
           format('%s opened %s''s account again.', v_admin_name, v_label),
           'info', '/customers');
      exception when foreign_key_violation then
        null;
      end;

      v_result := 'activated';

    -- Delete --------------------------------------------------------------------------
    else
      insert into customer_account_changes (customer_id, action, done_by, done_by_name)
      values (p_customer, case when v_has_records then 'erased' else 'deleted' end, p_admin, v_admin_name);

      delete from notifications where user_id = p_customer;

      if not v_has_records then
        -- Nothing on record: the profile goes, and its saved locations with it.
        delete from profiles where id = p_customer;
        v_result := 'deleted';
      else
        -- The person goes; the records stay, under "Deleted customer".
        update profiles
        set name = 'Deleted customer',
            company = null,
            contact_number = null,
            address = null,
            email = 'deleted-' || replace(p_customer::text, '-', '') || '@deleted.invalid',
            erased_at = now()
        where id = p_customer;

        update delivery_locations
        set location_name = 'Deleted customer',
            recipient_name = null,
            contact_number = null,
            address = '(erased)',
            is_archived = true
        where profile_id = p_customer;

        update customer_order_payment_history set done_by_name = 'Deleted customer' where done_by = p_customer;
        update label_exchange_history set done_by_name = 'Deleted customer' where done_by = p_customer;
        update order_rush_agreements set agreed_by_name = 'Deleted customer' where agreed_by = p_customer;

        -- The addresses in their requests' location changes (037, if run).
        if to_regclass('public.quotation_request_location_changes') is not null then
          execute $q$
            update quotation_request_location_changes c
            set changed_by_name = case when c.changed_by = $1 then 'Deleted customer' else c.changed_by_name end,
                from_text = (select concat_ws(', ', 'Deleted customer', l.country) from delivery_locations l where l.id = c.from_location_id),
                to_text = (select concat_ws(', ', 'Deleted customer', l.country) from delivery_locations l where l.id = c.to_location_id)
            where c.quotation_request_id in (select id from quotation_requests where customer_id = $1)
          $q$ using p_customer;
        end if;

        v_result := 'erased';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'customer', jsonb_build_object('id', p_customer, 'label', v_label, 'status', v_status),
    'action', v_action,
    'allowed', v_refusal is null,
    'refusal', v_refusal,
    'cancel_orders', v_cancel_orders,
    'cancel_requests', v_cancel_reqs,
    'withdraw_quotations', v_withdraw,
    'carry_on', v_carry_on,
    'payment_checks', v_checks,
    'balances', v_balances,
    'waiting_goods', v_waiting,
    'records', v_records,
    'erases', v_has_records,
    'done', v_result is not null,
    'result', v_result
  );
end;
$$;

revoke execute on function public.customer_account_step(uuid, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.customer_account_step(uuid, text, uuid, boolean) to service_role;


-- 5. No new orders: no new requests, no approvals ----------------------------------------
-- Next to the credit limit's checks (002), and named to run before them.
create or replace function public.refuse_closed_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer profiles%rowtype;
begin
  select * into v_customer from profiles where id = new.customer_id;

  if v_customer.id is null then
    return new;
  end if;

  if v_customer.erased_at is not null
     or not coalesce(v_customer.is_active, true)
     or v_customer.new_orders_stopped_at is not null then
    if tg_table_name = 'quotation_requests' then
      raise exception 'DMC has stopped new orders on this account, so new quotation requests can''t be sent. Orders already paid for carry on as usual. Please contact DMC about new orders.';
    end if;
    raise exception 'DMC has stopped new orders on this account, so this quotation can''t be approved. Orders already paid for carry on as usual. Please contact DMC about new orders.';
  end if;

  return new;
end;
$$;

revoke execute on function public.refuse_closed_account() from public, anon, authenticated;

drop trigger if exists quotation_requests_account_open on public.quotation_requests;
create trigger quotation_requests_account_open
  before insert on public.quotation_requests
  for each row execute function public.refuse_closed_account();

drop trigger if exists customer_orders_account_open on public.customer_orders;
create trigger customer_orders_account_open
  before insert on public.customer_orders
  for each row execute function public.refuse_closed_account();


-- 6. No new orders: no rush shipment -----------------------------------------------------
-- What a rush shipment leaves behind waits for the customer's next order. As
-- in 034, plus that check.
create or replace function public.rush_refusal(p_order customer_orders, p_cases_now integer, p_cases_waiting integer)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_agreed timestamptz;
begin
  if p_order.id is null then
    return 'Order not found.';
  end if;

  if p_order.customer_id is distinct from auth.uid() or public.my_role() is distinct from 'customer' then
    return 'Only the customer who placed this order can ask for a rush shipment.';
  end if;

  if exists (select 1 from profiles where id = p_order.customer_id and new_orders_stopped_at is not null) then
    return 'DMC has stopped new orders on your account, and what a rush shipment leaves behind waits for your next order, so a rush shipment isn''t possible. This order ships once all its goods are in.';
  end if;

  select agreed_at into v_agreed from order_rush_agreements where customer_order_id = p_order.id;
  if found then
    return format('A rush shipment was already agreed for %s on %s.', p_order.order_number,
      to_char(v_agreed at time zone 'Asia/Manila', 'FMMon FMDD, YYYY'));
  end if;

  if coalesce(lower(trim(p_order.status)), '') <> 'procurement' then
    return format('A rush shipment can only be asked for while the order waits for its suppliers'' deliveries (Procurement). %s is at "%s".',
      p_order.order_number, coalesce(p_order.status, 'no status'));
  end if;

  if coalesce(p_order.settled_amount, 0) <= 0 then
    return 'The down payment must be verified first.';
  end if;

  if coalesce(p_cases_now, 0) <= 0 then
    return 'None of this order''s goods have arrived yet, so there is nothing to ship now.';
  end if;

  if coalesce(p_cases_waiting, 0) <= 0 then
    return 'All of this order''s goods have arrived: it will move on to the warehouse without a rush shipment.';
  end if;

  return null;
end;
$$;

revoke execute on function public.rush_refusal(customer_orders, integer, integer) from public, anon, authenticated;


-- 7. Only these steps open or close an account ---------------------------------------------
-- Sales may still edit a customer's details (013), but not whether the account
-- is open, and nobody edits a deleted customer.
create or replace function public.protect_customer_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The server's steps and the SQL editor have no signed-in user.
  if auth.uid() is null or coalesce(lower(trim(old.role)), '') <> 'customer' then
    return new;
  end if;

  if old.erased_at is not null then
    raise exception 'This customer was deleted, so their record can''t be changed.';
  end if;

  if new.is_active is distinct from old.is_active
     or new.new_orders_stopped_at is distinct from old.new_orders_stopped_at
     or new.deactivated_at is distinct from old.deactivated_at
     or new.erased_at is distinct from old.erased_at then
    raise exception 'A customer''s new orders are stopped, and the account deactivated or deleted, by admin on the Customers page.';
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_customer_account() from public, anon, authenticated;

drop trigger if exists profiles_protect_customer_account on public.profiles;
create trigger profiles_protect_customer_account
  before update on public.profiles
  for each row execute function public.protect_customer_account();


-- 8. Nobody deletes a customer directly ------------------------------------------------------
create or replace function public.refuse_direct_customer_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(lower(trim(old.role)), '') <> 'customer' then
    return old;
  end if;

  raise exception '% can''t be deleted here. Admin deletes a customer on the Customers page: first deactivate them, then delete.',
    coalesce(nullif(trim(old.company), ''), old.name, 'This customer');
end;
$$;

revoke execute on function public.refuse_direct_customer_delete() from public, anon, authenticated;

drop trigger if exists profiles_no_direct_customer_delete on public.profiles;
create trigger profiles_no_direct_customer_delete
  before delete on public.profiles
  for each row execute function public.refuse_direct_customer_delete();

-- Sales could delete customers (013). Only admin, and only through the steps.
drop policy if exists "sales: delete customers" on public.profiles;


-- 9. An order always keeps its customer --------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customer_orders_customer_id_fkey') then
    alter table public.customer_orders
      add constraint customer_orders_customer_id_fkey
      foreign key (customer_id) references public.profiles (id) not valid;
  end if;

  -- Checked for every order already there, unless one has lost its customer
  -- (the last query counts them).
  if not exists (
    select 1 from public.customer_orders o
    where o.customer_id is not null
      and not exists (select 1 from public.profiles p where p.id = o.customer_id)
  ) then
    alter table public.customer_orders validate constraint customer_orders_customer_id_fkey;
  end if;
end;
$$;

-- A profile stays when its sign-in is deleted (the server deletes an erased
-- customer's sign-in, and their records keep their customer). Before, deleting
-- a sign-in deleted the profile too.
alter table public.profiles drop constraint if exists profiles_id_fkey;


-- Check: true, true, true, 0.
select
  to_regprocedure('public.customer_account_step(uuid, text, uuid, boolean)') is not null as account_steps,
  exists (select 1 from pg_trigger where tgname = 'customer_orders_account_open') as no_new_orders_rule,
  not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'sales: delete customers') as only_admin_deletes,
  (select count(*) from public.customer_orders o
   where o.customer_id is not null
     and not exists (select 1 from public.profiles p where p.id = o.customer_id)) as orders_without_customer;
