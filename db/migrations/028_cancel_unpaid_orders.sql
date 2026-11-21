-- =============================================================================
-- 028: An order whose down payment never comes is cancelled
--
-- DMC's rule (2026-11-18). The down payment is due 7 days after the quotation
-- expires (BR-19). The customer is reminded 2 days before that deadline and on
-- the day itself, and sales is told on the day. The down payment can still be
-- paid for 7 more days. If it still hasn't come after those 7 days, the order
-- is cancelled.
--   e.g. quotation expires Nov 18 -> deadline Nov 25 -> reminders Nov 23 and
--        Nov 25 -> can still be paid until Dec 2 -> cancelled on Dec 3.
--
-- Nothing is deleted. The order is kept, with the status "cancelled" and when
-- and why. Its quotation and request are kept too, marked cancelled. A
-- cancelled order no longer counts toward the customer's credit limit.
--
-- The server runs apply_payment_deadlines() every 5 minutes
-- (server/paymentDeadlines.js). Each reminder and each cancellation happens
-- once, in one step, however many servers run it. Once the 7 days are over a
-- customer can't pay, even in the minutes before the next run.
--
-- An order whose payment was sent and is waiting for sales to check it is
-- never cancelled. If sales rejects that payment after the 7 days are over, the
-- order is cancelled at the next run.
--
-- Safe to run more than once. Existing pieces it changes:
-- customer_outstanding_balance() (cancelled orders no longer count). No
-- policies are dropped, so older screens keep working.
-- =============================================================================


-- When and why an order was cancelled -------------------------------------------
alter table public.customer_orders
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;


-- The dates ---------------------------------------------------------------------
-- From the order's expiry date (its quotation's): the down payment's deadline,
-- and the last day it can still be paid. The order is cancelled the day after.
create or replace function public.down_payment_deadline(p_expiry date)
returns date
language sql
immutable
as $$
  select p_expiry + 7
$$;

create or replace function public.down_payment_last_day(p_expiry date)
returns date
language sql
immutable
as $$
  select p_expiry + 7 + 7
$$;


-- The reminders sent, so each goes out once ----------------------------------------
-- Keyed by the deadline too: if an order's deadline is moved, its reminders
-- are due again for the new date. Only the database's own steps use this table.
create table if not exists public.payment_deadline_notices (
  id uuid primary key default gen_random_uuid(),
  customer_order_id uuid not null references public.customer_orders (id) on delete cascade,
  kind text not null check (kind in ('reminder', 'deadline', 'cancelled')),
  deadline date not null,
  sent_at timestamptz not null default now(),
  unique (customer_order_id, kind, deadline)
);

alter table public.payment_deadline_notices enable row level security;
revoke all on public.payment_deadline_notices from anon, authenticated;


-- A customer can't pay once the 7 days are over -------------------------------------
-- Checked as the payment is saved, so it holds even before the next run has
-- cancelled the order. Also: a payment needs its amount, so the status can't
-- be set to "submitted" on its own (that would leave the order waiting for a
-- payment that was never sent, and it would never be cancelled).
create or replace function public.refuse_late_down_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Staff, the server and the SQL editor aren't held to it.
  if auth.uid() is null or public.my_role() is distinct from 'customer' then
    return new;
  end if;

  if coalesce(lower(trim(old.status)), '') = 'cancelled' then
    raise exception '% was cancelled%, so it can''t be paid any more. Nothing was changed. To order these products, please send a new quotation request.',
      coalesce(old.order_number, 'This order'),
      coalesce(' on ' || to_char(old.cancelled_at at time zone 'Asia/Manila', 'FMMon FMDD, YYYY'), '');
  end if;

  if new.status is distinct from old.status
     and coalesce(lower(trim(new.status)), '') = 'submitted'
     and coalesce(new.pending_payment_amount, 0) <= 0 then
    raise exception 'A payment needs its amount. Nothing was changed.';
  end if;

  -- A down payment being sent for an order that was waiting for one.
  if coalesce(old.settled_amount, 0) <= 0
     and coalesce(lower(trim(old.status)), '') in ('pending payment', 'payment rejected')
     and (new.status is distinct from old.status
          or coalesce(new.pending_payment_amount, 0) > coalesce(old.pending_payment_amount, 0))
     and old.expiry_date is not null
     and (now() at time zone 'Asia/Manila')::date > public.down_payment_last_day(old.expiry_date) then
    raise exception 'The last day to pay the down payment for % was %, so it can''t be paid any more and the order is being cancelled. Nothing was changed. To order these products, please send a new quotation request.',
      coalesce(old.order_number, 'this order'),
      to_char(public.down_payment_last_day(old.expiry_date), 'FMMon FMDD, YYYY');
  end if;

  return new;
end;
$$;

revoke execute on function public.refuse_late_down_payment() from public, anon, authenticated;

-- Named to run before customer_orders_protect_payments (BEFORE triggers run in
-- name order), so a customer paying a cancelled order is told why.
drop trigger if exists customer_orders_payment_deadline on public.customer_orders;
create trigger customer_orders_payment_deadline
  before update on public.customer_orders
  for each row execute function public.refuse_late_down_payment();


-- Reminders and cancellations, run by the server every 5 minutes ----------------------
-- For each order still waiting for its down payment (nothing paid, nothing
-- waiting to be checked):
--   2 days before the deadline       -> reminder to the customer
--   from the deadline day            -> notice to the customer and to sales
--   more than 7 days after deadline  -> cancelled: customer, sales, management told
-- Each goes out once. Only the latest due applies: an order the server didn't
-- see on its reminder day gets the deadline notice, not both.
-- p_today stands in for today (Philippine time) in rehearsals; p_dry_run says
-- what would happen without changing anything.
create or replace function public.apply_payment_deadlines(p_today date default null, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today       date := coalesce(p_today, (now() at time zone 'Asia/Manila')::date);
  v_order       record;
  v_deadline    date;
  v_last_day    date;
  v_cancel_on   date;
  v_kind        text;
  v_new         integer;
  v_money       text;
  v_quotation   text;
  v_request_id  uuid;
  v_reminders   jsonb := '[]'::jsonb;
  v_notices     jsonb := '[]'::jsonb;
  v_cancelled   jsonb := '[]'::jsonb;
  c_day         constant text := 'FMMon FMDD, YYYY';
begin
  for v_order in
    select o.*
    from customer_orders o
    where coalesce(lower(trim(o.status)), '') in ('pending payment', 'payment rejected')
      and coalesce(o.settled_amount, 0) <= 0
      and coalesce(o.pending_payment_amount, 0) <= 0
      and o.expiry_date is not null
      and v_today >= public.down_payment_deadline(o.expiry_date) - 2
    order by o.expiry_date, o.order_number
    for update
  loop
    v_deadline := public.down_payment_deadline(v_order.expiry_date);
    v_last_day := public.down_payment_last_day(v_order.expiry_date);
    v_cancel_on := v_last_day + 1;
    v_money := '₱ ' || to_char(coalesce(v_order.down_payment_amount, 0), 'FM999,999,999,990.00');
    v_kind := case
      when v_today >= v_cancel_on then 'cancelled'
      when v_today >= v_deadline then 'deadline'
      else 'reminder'
    end;

    -- Sent before? (A cancellation can't be: the order would no longer be listed.)
    if v_kind <> 'cancelled' and exists (
      select 1 from payment_deadline_notices n
      where n.customer_order_id = v_order.id and n.kind = v_kind and n.deadline = v_deadline
    ) then
      continue;
    end if;

    if p_dry_run then
      if v_kind = 'cancelled' then
        v_cancelled := v_cancelled || to_jsonb(v_order.order_number);
      elsif v_kind = 'deadline' then
        v_notices := v_notices || to_jsonb(v_order.order_number);
      else
        v_reminders := v_reminders || to_jsonb(v_order.order_number);
      end if;
      continue;
    end if;

    insert into payment_deadline_notices (customer_order_id, kind, deadline)
    values (v_order.id, v_kind, v_deadline)
    on conflict (customer_order_id, kind, deadline) do nothing;
    get diagnostics v_new = row_count;
    if v_new = 0 then
      continue;
    end if;

    if v_kind = 'cancelled' then
      update customer_orders
      set status = 'cancelled',
          cancelled_at = now(),
          cancellation_reason = format(
            'The down payment wasn''t received by %s, 7 days after its deadline of %s.',
            to_char(v_last_day, c_day), to_char(v_deadline, c_day))
      where id = v_order.id;

      insert into customer_order_status_history (customer_order_id, previous_status, new_status, changed_at)
      values (v_order.id, v_order.status, 'cancelled', now());

      -- Its quotation and request stay on record, marked cancelled. (Orders made
      -- before quotations were linked are matched by the quotation's number.)
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

      begin
        insert into notifications (user_id, role, title, message, type, link, related_customer_order_id)
        values
          (v_order.customer_id, 'customer',
           format('%s - Cancelled', v_order.order_number),
           format('Your order %s was cancelled because its down payment of %s wasn''t received by %s, 7 days after its deadline of %s. To order these products, please send a new quotation request.',
             v_order.order_number, v_money, to_char(v_last_day, c_day), to_char(v_deadline, c_day)),
           'warning', '/my-orders', v_order.id),
          (v_order.customer_id, 'sales',
           format('%s - Cancelled: down payment not received', v_order.order_number),
           format('%s was cancelled automatically: its down payment of %s wasn''t received by %s, 7 days after its deadline of %s.%s',
             v_order.order_number, v_money, to_char(v_last_day, c_day), to_char(v_deadline, c_day),
             coalesce(format(' Its quotation %s is kept, marked cancelled.', v_quotation), '')),
           'warning', '/customer-orders', v_order.id),
          (v_order.customer_id, 'management',
           format('%s - Cancelled: down payment not received', v_order.order_number),
           format('%s was cancelled automatically: its down payment of %s wasn''t received by %s, 7 days after its deadline of %s.',
             v_order.order_number, v_money, to_char(v_last_day, c_day), to_char(v_deadline, c_day)),
           'warning', '/executive-dashboard', v_order.id);
      exception when foreign_key_violation then
        null;  -- the customer's account no longer exists: nobody to tell
      end;

      v_cancelled := v_cancelled || to_jsonb(v_order.order_number);

    elsif v_kind = 'deadline' then
      begin
        insert into notifications (user_id, role, title, message, type, link, related_customer_order_id)
        values
          (v_order.customer_id, 'customer',
           case when v_today = v_deadline
             then format('%s - Down payment due today', v_order.order_number)
             else format('%s - Down payment overdue', v_order.order_number)
           end,
           case when v_today = v_deadline
             then format('Today, %s, is the deadline for the down payment of %s for order %s. If it isn''t received by %s, the order will be cancelled on %s.',
               to_char(v_deadline, c_day), v_money, v_order.order_number, to_char(v_last_day, c_day), to_char(v_cancel_on, c_day))
             else format('The down payment of %s for order %s was due on %s. If it isn''t received by %s, the order will be cancelled on %s.',
               v_money, v_order.order_number, to_char(v_deadline, c_day), to_char(v_last_day, c_day), to_char(v_cancel_on, c_day))
           end,
           'warning', '/payments', v_order.id),
          (v_order.customer_id, 'sales',
           format('%s - Down payment not received', v_order.order_number),
           format('The down payment of %s for %s was due on %s and hasn''t been received. If it isn''t received by %s, the order will be cancelled automatically on %s.',
             v_money, v_order.order_number, to_char(v_deadline, c_day), to_char(v_last_day, c_day), to_char(v_cancel_on, c_day)),
           'warning', '/customer-orders', v_order.id);
      exception when foreign_key_violation then
        null;
      end;

      v_notices := v_notices || to_jsonb(v_order.order_number);

    else
      begin
        insert into notifications (user_id, role, title, message, type, link, related_customer_order_id)
        values
          (v_order.customer_id, 'customer',
           format('%s - Down payment due %s', v_order.order_number, to_char(v_deadline, c_day)),
           format('Please pay the down payment of %s for order %s by %s on the Payments page.',
             v_money, v_order.order_number, to_char(v_deadline, c_day)),
           'info', '/payments', v_order.id);
      exception when foreign_key_violation then
        null;
      end;

      v_reminders := v_reminders || to_jsonb(v_order.order_number);
    end if;
  end loop;

  return jsonb_build_object(
    'today', v_today,
    'dry_run', p_dry_run,
    'reminders', v_reminders,
    'deadline_notices', v_notices,
    'cancelled', v_cancelled
  );
end;
$$;

revoke execute on function public.apply_payment_deadlines(date, boolean) from public, anon, authenticated;
grant execute on function public.apply_payment_deadlines(date, boolean) to service_role;


-- A cancelled order no longer counts toward the credit limit --------------------------
create or replace function public.customer_outstanding_balance(p_customer_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(greatest(coalesce(total_amount, 0) - coalesce(settled_amount, 0), 0)), 0)
  from customer_orders
  where customer_id = p_customer_id
    and coalesce(lower(trim(status)), '') <> 'cancelled'
$$;

revoke execute on function public.customer_outstanding_balance(uuid) from public, anon, authenticated;


-- Check: the step and the guard are in place, and what the first run will do
-- (nothing is changed by this query; "none" means nothing is due today).
with first_run as (
  select public.apply_payment_deadlines(null, true) as r
)
select
  to_regprocedure('public.apply_payment_deadlines(date, boolean)') is not null as deadlines_step,
  exists (
    select 1 from pg_trigger
    where tgname = 'customer_orders_payment_deadline' and tgrelid = 'public.customer_orders'::regclass
  ) as late_payment_refused,
  coalesce((select string_agg(value, ', ') from first_run, jsonb_array_elements_text(r -> 'cancelled')), 'none') as cancelled_at_first_run,
  coalesce((select string_agg(value, ', ') from first_run, jsonb_array_elements_text(r -> 'deadline_notices')), 'none') as deadline_notices_now,
  coalesce((select string_agg(value, ', ') from first_run, jsonb_array_elements_text(r -> 'reminders')), 'none') as reminders_now;
