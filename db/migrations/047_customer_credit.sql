-- =============================================================================
-- 047: Credit is given by DMC, customer by customer
--
-- As DMC decided (2026-11-22):
--   - a customer has credit only when DMC gives it. Only admin gives it,
--     changes its limit or removes it, on the Customers page, and each
--     customer has their own limit;
--   - a new customer has no credit. They still pay the 50% down payment, but
--     an order ships only once it's paid in full, and they can have only one
--     unpaid order at a time: while an earlier order isn't paid in full, a new
--     quotation can't be sent to them or approved by them (their requests are
--     still taken, and put on hold until they pay);
--   - customers who had credit before keep it, at the standard limit as it is
--     now, so nothing changes for them;
--   - the standard limit (Markups & Credit) is what admin starts from when
--     giving a customer credit. Changing it changes nobody's limit.
-- Every change is recorded (who, when, and what the customer owed then). The
-- customer is told, and sales is told when a request on hold may fit now.
-- Safe to run more than once. The last query shows true, true, true, true,
-- then how many customers have credit and how many don't (0 the first time).
-- =============================================================================


-- 1. Each customer's credit, and every change to it ------------------------------------------
create table if not exists public.customer_credit_changes (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.profiles(id) on delete cascade,
  kind             text not null check (kind in ('kept from before', 'given', 'limit changed', 'removed')),
  credit_limit     numeric,          -- after the change (none = no credit)
  previous_limit   numeric,          -- before it (none = had no credit)
  owed_then        numeric not null default 0,
  changed_at       timestamptz not null default now(),
  changed_by       uuid,
  changed_by_name  text
);

create index if not exists customer_credit_changes_customer
  on public.customer_credit_changes (customer_id, changed_at desc);

alter table public.customer_credit_changes enable row level security;

drop policy if exists "staff: read credit changes" on public.customer_credit_changes;
create policy "staff: read credit changes" on public.customer_credit_changes
  for select to authenticated
  using ((select public.has_role('admin', 'management', 'sales')));

-- Added once: the customers there are now keep their credit, at the standard
-- limit as it is now. (Run again, this does nothing: customers added since
-- then have no credit until admin gives it.)
do $$
declare
  v_standard numeric;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'has_credit') then
    return;
  end if;

  alter table public.profiles
    add column has_credit boolean not null default false,
    add column credit_limit numeric,
    add column credit_changed_at timestamptz,
    add column credit_changed_by_name text;

  select value into v_standard from public.business_settings where key = 'credit_limit';
  v_standard := coalesce(v_standard, 1500000);

  update public.profiles
  set has_credit = true,
      credit_limit = v_standard,
      credit_changed_at = now(),
      credit_changed_by_name = 'Kept from before'
  where lower(trim(role)) = 'customer'
    and erased_at is null;

  insert into public.customer_credit_changes (customer_id, kind, credit_limit, owed_then, changed_by_name)
  select p.id, 'kept from before', v_standard, public.customer_outstanding_balance(p.id), 'Kept from before'
  from public.profiles p
  where p.has_credit;
end;
$$;

alter table public.profiles drop constraint if exists profiles_credit_needs_a_limit;
alter table public.profiles add constraint profiles_credit_needs_a_limit
  check (not has_credit or coalesce(credit_limit, 0) > 0);


-- 2. A customer's orders not paid in full ---------------------------------------------------
-- Internal, for the messages below.
create or replace function public.customer_unpaid_orders(p_customer_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select string_agg(order_number, ', ' order by order_number)
  from customer_orders
  where customer_id = p_customer_id
    and coalesce(lower(trim(status)), '') <> 'cancelled'
    and coalesce(total_amount, 0) - coalesce(settled_amount, 0) > 0.009
$$;

revoke execute on function public.customer_unpaid_orders(uuid) from public, anon, authenticated;


-- 3. Credit status, for the screens -----------------------------------------------------------
-- As in 002, with the customer's own limit and whether they have credit at all.
-- Without credit: no limit, never blocked from asking, one unpaid order at a time.
drop function if exists public.credit_status(uuid);
create function public.credit_status(p_customer_id uuid)
returns table (outstanding numeric, credit_limit numeric, blocked boolean, has_credit boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_customer_id is distinct from auth.uid() and not exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role in ('admin', 'management', 'sales')
  ) then
    raise exception 'You can only view your own balance.';
  end if;

  outstanding := customer_outstanding_balance(p_customer_id);

  select coalesce(p.has_credit, false), case when p.has_credit then p.credit_limit end
    into has_credit, credit_limit
  from profiles p
  where p.id = p_customer_id;

  has_credit := coalesce(has_credit, false);
  blocked := has_credit and credit_limit is not null and outstanding >= credit_limit;

  return next;
end;
$$;

revoke execute on function public.credit_status(uuid) from public, anon;
grant execute on function public.credit_status(uuid) to authenticated;


-- 4. New requests: refused only when a customer with credit has reached their limit ---------
-- A customer without credit can always ask: what they owe is checked when the
-- quotation is sent (5) and approved (6).
create or replace function public.enforce_credit_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has          boolean;
  v_limit        numeric;
  v_outstanding  numeric;
begin
  select p.has_credit, p.credit_limit into v_has, v_limit
  from profiles p
  where p.id = new.customer_id;

  if not coalesce(v_has, false) or v_limit is null then
    return new;
  end if;

  v_outstanding := customer_outstanding_balance(new.customer_id);

  if v_outstanding >= v_limit then
    raise exception 'Unpaid balance of ₱% has reached the credit limit of ₱%. Pay your open orders before placing a new one.',
      to_char(v_outstanding, 'FM999,999,999,990.00'),
      to_char(v_limit, 'FM999,999,999,990.00');
  end if;

  return new;
end;
$$;


-- 5. Sending a quotation: only if it fits ---------------------------------------------------
-- As in 040, with the customer's own limit. Without credit, it fits only when
-- they owe nothing.
create or replace function public.refuse_quotation_over_credit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has        boolean;
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

  select r.customer_id, r.quotation_reference into v_customer, v_reference
  from quotation_requests r
  where r.id = new.quotation_request_id;

  select coalesce(p.has_credit, false), p.credit_limit, coalesce(nullif(trim(p.company), ''), p.name)
    into v_has, v_limit, v_label
  from profiles p
  where p.id = v_customer;

  v_owed := customer_outstanding_balance(v_customer);

  if v_has and v_owed + coalesce(new.total_amount, 0) > v_limit then
    raise exception 'This quotation (₱%) would take % over the credit limit if they approve it: they owe ₱% of ₱%. It can''t be sent: put % on hold until they pay.',
      to_char(coalesce(new.total_amount, 0), c_money), coalesce(v_label, 'the customer'),
      to_char(v_owed, c_money), to_char(v_limit, c_money), v_reference;
  end if;

  if not v_has and v_owed > 0.009 then
    raise exception '% has no credit from DMC, so they can have only one unpaid order at a time, and they still owe ₱% on %. This quotation can''t be sent yet: put % on hold until they pay.',
      coalesce(v_label, 'The customer'), to_char(v_owed, c_money),
      coalesce(public.customer_unpaid_orders(v_customer), 'an order'), v_reference;
  end if;

  -- Sent: whatever hold it had is over.
  update quotation_requests
  set credit_hold_at = null, credit_hold_by = null, credit_hold_by_name = null
  where id = new.quotation_request_id
    and credit_hold_at is not null;

  return new;
end;
$$;


-- 6. Approving a quotation ----------------------------------------------------------------------
-- As in 040, with the customer's own limit. Without credit: refused while an
-- earlier order isn't paid in full.
create or replace function public.enforce_credit_limit_on_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has    boolean;
  v_limit  numeric;
  v_owed   numeric;
  v_after  numeric;
  v_until  text;
  c_money  constant text := 'FM999,999,999,990.00';
begin
  -- One approval at a time per customer, so two can't both squeeze in.
  select coalesce(p.has_credit, false), p.credit_limit into v_has, v_limit
  from profiles p
  where p.id = new.customer_id
  for update;

  v_owed := customer_outstanding_balance(new.customer_id);
  v_until := coalesce(' (it can be approved until ' || to_char(new.expiry_date, 'FMMon FMDD, YYYY') || ')', '');

  if v_has then
    v_after := v_owed + coalesce(new.total_amount, 0);

    if v_after > v_limit then
      raise exception 'Approving this would bring your unpaid balance to ₱%, over your credit limit of ₱%. Pay at least ₱% of your open orders first, then approve it%.',
        to_char(v_after, c_money), to_char(v_limit, c_money), to_char(v_after - v_limit, c_money), v_until;
    end if;
  elsif v_owed > 0.009 then
    raise exception 'DMC hasn''t given you credit yet, so you can have one unpaid order at a time: pay the ₱% you still owe on % first, then approve this%.',
      to_char(v_owed, c_money), coalesce(public.customer_unpaid_orders(new.customer_id), 'your open orders'), v_until;
  end if;

  return new;
end;
$$;


-- 7. Putting a request on hold (sales or admin) --------------------------------------------
-- As in 040, with the customer's own limit, and for a customer without credit
-- who still owes on an order.
create or replace function public.hold_request_for_credit(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request  quotation_requests%rowtype;
  v_has      boolean;
  v_limit    numeric;
  v_owed     numeric;
  v_name     text;
  v_label    text;
  v_orders   text;
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

  if v_request.credit_hold_at is not null then
    return jsonb_build_object('reference', v_request.quotation_reference, 'held', true, 'already', true);
  end if;

  select coalesce(p.has_credit, false), p.credit_limit, coalesce(nullif(trim(p.company), ''), p.name)
    into v_has, v_limit, v_label
  from profiles p
  where p.id = v_request.customer_id;

  v_owed := customer_outstanding_balance(v_request.customer_id);

  if not v_has and v_owed <= 0.009 then
    raise exception '% has no credit but owes DMC nothing, so there''s nothing to hold % for: send it.',
      coalesce(v_label, 'The customer'), v_request.quotation_reference;
  end if;

  select name into v_name from profiles where id = auth.uid();

  update quotation_requests
  set credit_hold_at = now(),
      credit_hold_by = auth.uid(),
      credit_hold_by_name = v_name
  where id = p_request_id;

  v_orders := public.customer_unpaid_orders(v_request.customer_id);

  begin
    insert into notifications (user_id, role, title, message, type, link)
    values
      (v_request.customer_id, 'customer',
       format('%s - On hold until you pay', v_request.quotation_reference),
       case when v_has
         then format('DMC can''t send its prices for %s yet: approving it would take your unpaid balance over your credit limit of ₱%s. Pay your open orders on the Payments page, and DMC sends the prices once there''s room.',
           v_request.quotation_reference, to_char(v_limit, c_money))
         else format('DMC can''t send its prices for %s yet: %s isn''t paid in full, and until DMC gives you credit you can have one unpaid order at a time. Pay your open orders on the Payments page, and DMC sends the prices then.',
           v_request.quotation_reference, coalesce(v_orders, 'an order'))
       end,
       'warning', '/payments'),
      (v_request.customer_id, 'sales',
       format('%s - On hold (%s)', v_request.quotation_reference, case when v_has then 'credit limit' else 'unpaid order' end),
       case when v_has
         then format('%s put %s on hold: %s owes ₱%s of the ₱%s credit limit. You''ll be told when their balance goes down.',
           coalesce(v_name, 'Sales'), v_request.quotation_reference, coalesce(v_label, 'the customer'), to_char(v_owed, c_money), to_char(v_limit, c_money))
         else format('%s put %s on hold: %s has no credit from DMC and still owes ₱%s on %s. You''ll be told once they''ve paid it all.',
           coalesce(v_name, 'Sales'), v_request.quotation_reference, coalesce(v_label, 'the customer'), to_char(v_owed, c_money), coalesce(v_orders, 'their orders'))
       end,
       'info', '/pfi-builder');
  exception when foreign_key_violation then
    null;
  end;

  return jsonb_build_object('reference', v_request.quotation_reference, 'held', true, 'already', false);
end;
$$;

revoke execute on function public.hold_request_for_credit(uuid) from public, anon;
grant execute on function public.hold_request_for_credit(uuid) to authenticated;


-- 8. Telling sales when there may be room now ------------------------------------------------
-- As in 040, with the customer's own limit. Without credit: once they owe nothing.
create or replace function public.tell_sales_credit_room()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refs   text;
  v_has    boolean;
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

  select coalesce(p.has_credit, false), p.credit_limit, coalesce(nullif(trim(p.company), ''), p.name)
    into v_has, v_limit, v_label
  from profiles p
  where p.id = new.customer_id;

  v_owed := customer_outstanding_balance(new.customer_id);

  if not v_has and v_owed > 0.009 then
    return null;
  end if;

  begin
    insert into notifications (user_id, role, title, message, type, link)
    values (new.customer_id, 'sales',
      format('%s - Balance went down: %s on hold', coalesce(v_label, 'A customer'), v_refs),
      case when v_has
        then format('%s now owes ₱%s of the ₱%s credit limit (room ₱%s). Open %s in the PFI Builder: send it if its total fits now.',
          coalesce(v_label, 'The customer'), to_char(v_owed, c_money), to_char(v_limit, c_money),
          to_char(greatest(v_limit - v_owed, 0), c_money), v_refs)
        else format('%s has paid all their orders (they have no credit from DMC). Open %s in the PFI Builder and send it.',
          coalesce(v_label, 'The customer'), v_refs)
      end,
      'info', '/pfi-builder');
  exception when foreign_key_violation then
    null;
  end;

  return null;
end;
$$;


-- 9. The standard limit changes nobody's room ------------------------------------------------
-- It's only where admin starts from when giving credit, so changing it tells
-- nobody anything. Raising one customer's limit does (10).
drop trigger if exists business_settings_limit_raised on public.business_settings;
drop function if exists public.tell_sales_limit_raised();


-- 10. Giving, changing or removing a customer's credit (admin) ------------------------------
create or replace function public.set_customer_credit(p_customer_id uuid, p_has_credit boolean, p_limit numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer  profiles%rowtype;
  v_kind      text;
  v_limit     numeric := case when p_has_credit then round(p_limit, 2) end;
  v_name      text;
  v_label     text;
  v_owed      numeric;
  v_orders    text;
  v_refs      text;
  c_money     constant text := 'FM999,999,999,990.00';
begin
  if not public.has_role('admin') then
    raise exception 'Only admin can give, change or remove a customer''s credit.';
  end if;

  select * into v_customer from profiles where id = p_customer_id for update;

  if v_customer.id is null or coalesce(lower(trim(v_customer.role)), '') <> 'customer' then
    raise exception 'This customer no longer exists.';
  end if;

  if v_customer.erased_at is not null then
    raise exception 'This customer was deleted, so their credit can''t be changed.';
  end if;

  if p_has_credit is null then
    raise exception 'Choose whether the customer has credit.';
  end if;

  if p_has_credit and coalesce(v_limit, 0) <= 0 then
    raise exception 'Type the credit limit: the most this customer may owe DMC, above ₱0.';
  end if;

  v_kind := case
    when p_has_credit and not v_customer.has_credit then 'given'
    when not p_has_credit and v_customer.has_credit then 'removed'
    when p_has_credit and v_limit is distinct from v_customer.credit_limit then 'limit changed'
  end;

  if v_kind is null then
    return jsonb_build_object('changed', false, 'has_credit', v_customer.has_credit, 'credit_limit', v_customer.credit_limit);
  end if;

  select name into v_name from profiles where id = auth.uid();
  v_label := coalesce(nullif(trim(v_customer.company), ''), v_customer.name, 'The customer');
  v_owed := customer_outstanding_balance(p_customer_id);
  v_orders := customer_unpaid_orders(p_customer_id);

  perform set_config('dmc.credit_step', 'on', true);
  update profiles
  set has_credit = p_has_credit,
      credit_limit = v_limit,
      credit_changed_at = now(),
      credit_changed_by_name = v_name
  where id = p_customer_id;
  perform set_config('dmc.credit_step', 'off', true);

  insert into customer_credit_changes (customer_id, kind, credit_limit, previous_limit, owed_then, changed_by, changed_by_name)
  values (p_customer_id, v_kind, v_limit, case when v_customer.has_credit then v_customer.credit_limit end, v_owed, auth.uid(), v_name);

  begin
    insert into notifications (user_id, role, title, message, type, link)
    values (p_customer_id, 'customer',
      case v_kind
        when 'given' then 'DMC gave you credit'
        when 'limit changed' then format('Your credit limit is now ₱%s', to_char(v_limit, c_money))
        else 'Your account has no credit now'
      end,
      case v_kind
        when 'given' then format('You may now owe DMC up to ₱%s on your orders: they can ship before they''re paid in full, and you can approve a new order while others are unpaid, as long as what you owe stays within ₱%s.',
          to_char(v_limit, c_money), to_char(v_limit, c_money))
        when 'limit changed' then format('You may owe DMC up to ₱%s on your orders (it was ₱%s). You owe ₱%s now.',
          to_char(v_limit, c_money), to_char(v_customer.credit_limit, c_money), to_char(v_owed, c_money))
        else format('From now on each order ships only once it''s paid in full, and you can approve a new order only when your orders are paid.%s',
          case when v_owed > 0.009
            then format(' You owe ₱%s on %s: pay it on the Payments page before they ship.', to_char(v_owed, c_money), coalesce(v_orders, 'your orders'))
            else '' end)
      end,
      case when v_kind = 'removed' then 'warning' else 'info' end,
      '/payments');
  exception when foreign_key_violation then
    null;  -- the customer's sign-in no longer exists: nobody to tell
  end;

  -- Requests on hold that may fit now.
  select string_agg(r.quotation_reference, ', ' order by r.created_at) into v_refs
  from quotation_requests r
  where r.customer_id = p_customer_id
    and r.credit_hold_at is not null
    and coalesce(lower(trim(r.status)), '') = 'awaiting pricing';

  if v_refs is not null and (v_kind = 'given' or (v_kind = 'limit changed' and v_limit > v_customer.credit_limit)) then
    begin
      insert into notifications (user_id, role, title, message, type, link)
      values (p_customer_id, 'sales',
        format('%s - Credit %s: %s on hold', v_label, case v_kind when 'given' then 'given' else 'limit raised' end, v_refs),
        format('%s may now owe up to ₱%s (they owe ₱%s, room ₱%s). Open %s in the PFI Builder: send it if its total fits now.',
          v_label, to_char(v_limit, c_money), to_char(v_owed, c_money), to_char(greatest(v_limit - v_owed, 0), c_money), v_refs),
        'info', '/pfi-builder');
    exception when foreign_key_violation then
      null;
    end;
  end if;

  return jsonb_build_object('changed', true, 'kind', v_kind, 'has_credit', p_has_credit, 'credit_limit', v_limit, 'owed', v_owed);
end;
$$;

revoke execute on function public.set_customer_credit(uuid, boolean, numeric) from public, anon;
grant execute on function public.set_customer_credit(uuid, boolean, numeric) to authenticated;


-- 11. Only that step changes a customer's credit --------------------------------------------
-- Sales may edit a customer's details (013), but not their credit. A customer
-- added by a signed-in user starts without credit.
create or replace function public.protect_customer_credit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The server's steps and the SQL editor have no signed-in user.
  if auth.uid() is null or coalesce(current_setting('dmc.credit_step', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.has_credit := false;
    new.credit_limit := null;
    new.credit_changed_at := null;
    new.credit_changed_by_name := null;
    return new;
  end if;

  if new.has_credit is distinct from old.has_credit
     or new.credit_limit is distinct from old.credit_limit
     or new.credit_changed_at is distinct from old.credit_changed_at
     or new.credit_changed_by_name is distinct from old.credit_changed_by_name then
    raise exception 'A customer''s credit is given, changed or removed only by admin, on the Customers page.';
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_customer_credit() from public, anon, authenticated;

drop trigger if exists profiles_protect_customer_credit on public.profiles;
create trigger profiles_protect_customer_credit
  before insert or update on public.profiles
  for each row execute function public.protect_customer_credit();


-- 12. Without credit, an order ships only once it's paid in full -----------------------------
create or replace function public.check_paid_before_shipping(p_customer_id uuid, p_order_number text, p_total numeric, p_settled numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has    boolean;
  v_label  text;
  v_due    numeric := coalesce(p_total, 0) - coalesce(p_settled, 0);
  c_money  constant text := 'FM999,999,999,990.00';
begin
  if v_due <= 0.009 then
    return;
  end if;

  select coalesce(p.has_credit, false), coalesce(nullif(trim(p.company), ''), p.name)
    into v_has, v_label
  from profiles p
  where p.id = p_customer_id;

  if coalesce(v_has, true) then
    return;
  end if;

  raise exception '% can''t ship yet: % has no credit from DMC, so their orders ship only once they''re paid in full, and ₱% of its ₱% is still to pay.',
    coalesce(p_order_number, 'This order'), coalesce(v_label, 'the customer'),
    to_char(v_due, c_money), to_char(coalesce(p_total, 0), c_money);
end;
$$;

revoke execute on function public.check_paid_before_shipping(uuid, text, numeric, numeric) from public, anon, authenticated;

-- However an order is marked shipped.
create or replace function public.refuse_unpaid_shipment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(lower(trim(new.status)), '') in ('shipped', 'partly shipped')
     and coalesce(lower(trim(old.status)), '') not in ('shipped', 'partly shipped') then
    perform public.check_paid_before_shipping(new.customer_id, new.order_number, new.total_amount, new.settled_amount);
  end if;

  return new;
end;
$$;

revoke execute on function public.refuse_unpaid_shipment() from public, anon, authenticated;

drop trigger if exists customer_orders_paid_before_shipping on public.customer_orders;
create trigger customer_orders_paid_before_shipping
  before update of status on public.customer_orders
  for each row execute function public.refuse_unpaid_shipment();

-- Shipping an order (034), checking the payment first, so the warehouse knows
-- before making its documents.
create or replace function public.ship_customer_order(p_customer_order_id uuid, p_check_only boolean default false)
returns table (customer_id uuid, order_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    customer_orders%rowtype;
  v_items    integer;
  v_applied  integer;
  v_item     record;
  v_line     uuid;
  v_status   text;
begin
  if not public.has_role('admin', 'warehouse') then
    raise exception 'Only warehouse staff can mark an order as shipped.';
  end if;

  -- One at a time: a second click waits here, then finds it shipped.
  select * into v_order from customer_orders o where o.id = p_customer_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;

  if lower(trim(v_order.status)) = 'shipped' then
    raise exception 'This order is already marked as shipped.';
  end if;

  if lower(trim(v_order.status)) = 'partly shipped' then
    raise exception 'This order''s container already left. Its waiting goods go with the customer''s next order.';
  end if;

  if lower(trim(v_order.status)) not in ('warehouse preparation', 'ready for shipment') then
    raise exception 'Only an order in warehouse preparation or ready for shipment can be shipped.';
  end if;

  -- A customer without credit from DMC pays in full before their goods ship (047).
  perform public.check_paid_before_shipping(v_order.customer_id, v_order.order_number, v_order.total_amount, v_order.settled_amount);

  -- Every item going in this container has its labels applied, as of now.
  select count(*),
         count(*) filter (where exists (
           select 1 from compliance_label_exchanges e
           where e.customer_order_item_id = i.id and lower(trim(e.status)) = 'applied to units'
         ))
    into v_items, v_applied
  from customer_order_items i
  where i.customer_order_id = p_customer_order_id
    and coalesce(i.ship_quantity, i.quantity) > 0;

  if v_items = 0 or v_applied < v_items then
    raise exception 'Labels are applied on % of % items. Every item needs its labels applied before shipping.', v_applied, v_items;
  end if;

  if not p_check_only then
    if public.order_is_split(p_customer_order_id) then
      for v_item in
        select i.id, coalesce(i.ship_quantity, i.quantity) as cases
        from customer_order_items i
        where i.customer_order_id = p_customer_order_id
          and i.loaded_at is null
          and coalesce(i.ship_quantity, i.quantity) > 0
      loop
        select x.po_item_id into v_line from public.order_item_line(v_item.id) x;
        perform public.release_line_cases(v_line, v_item.cases);
      end loop;

      update customer_order_items
      set loaded_at = now()
      where customer_order_id = p_customer_order_id
        and loaded_at is null
        and coalesce(ship_quantity, quantity) > 0;
    else
      perform public.release_order_racks(p_customer_order_id);
    end if;

    v_status := case
      when exists (
        select 1 from customer_order_items i
        where i.customer_order_id = p_customer_order_id
          and i.ship_quantity is not null
          and i.ship_quantity < i.quantity
      ) then 'partly shipped'
      else 'shipped'
    end;

    update customer_orders
    set status = v_status,
        estimated_ship_date = (now() at time zone 'Asia/Manila')::date
    where id = p_customer_order_id;

    insert into customer_order_status_history (customer_order_id, previous_status, new_status, changed_at)
    values (p_customer_order_id, v_order.status, v_status, now());

    -- Earlier orders whose waiting goods have now all left finish too.
    perform public.settle_waiting_orders(p_customer_order_id);
  end if;

  return query select v_order.customer_id, v_order.order_number;
end;
$$;

revoke execute on function public.ship_customer_order(uuid, boolean) from public, anon;
grant execute on function public.ship_customer_order(uuid, boolean) to authenticated;


-- 13. The customer is told to pay the balance before it can ship ----------------------------
-- When an order without credit reaches the warehouse unpaid, once.
create or replace function public.tell_customer_to_pay_before_shipping()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has    boolean;
  v_label  text;
  v_due    numeric := coalesce(new.total_amount, 0) - coalesce(new.settled_amount, 0);
  c_money  constant text := 'FM999,999,999,990.00';
begin
  if coalesce(lower(trim(new.status)), '') not in ('warehouse preparation', 'ready for shipment')
     or coalesce(lower(trim(old.status)), '') in ('warehouse preparation', 'ready for shipment')
     or v_due <= 0.009 then
    return null;
  end if;

  select coalesce(p.has_credit, false), coalesce(nullif(trim(p.company), ''), p.name)
    into v_has, v_label
  from profiles p
  where p.id = new.customer_id;

  if coalesce(v_has, true) then
    return null;
  end if;

  begin
    insert into notifications (user_id, role, title, message, type, link, related_customer_order_id)
    values
      (new.customer_id, 'customer',
       format('%s - Pay the balance so it can ship', new.order_number),
       format('%s is being prepared at DMC''s warehouse. Until DMC gives you credit, an order ships only once it''s paid in full: pay its ₱%s balance on the Payments page.',
         new.order_number, to_char(v_due, c_money)),
       'warning', '/payments', new.id),
      (new.customer_id, 'sales',
       format('%s - Ships once it''s paid in full', new.order_number),
       format('%s has no credit from DMC: %s ships only once its ₱%s balance is paid.',
         coalesce(v_label, 'The customer'), new.order_number, to_char(v_due, c_money)),
       'info', '/customer-orders', new.id);
  exception when foreign_key_violation then
    null;
  end;

  return null;
end;
$$;

revoke execute on function public.tell_customer_to_pay_before_shipping() from public, anon, authenticated;

drop trigger if exists customer_orders_pay_before_shipping on public.customer_orders;
create trigger customer_orders_pay_before_shipping
  after update of status on public.customer_orders
  for each row execute function public.tell_customer_to_pay_before_shipping();


-- Check: true, true, true, true, then how many customers have credit (all of
-- them, the first time) and how many don't (0 the first time).
select
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'profiles' and column_name = 'has_credit') as credit_per_customer,
  to_regprocedure('public.set_customer_credit(uuid, boolean, numeric)') is not null as admin_gives_credit,
  exists (select 1 from pg_trigger where tgname = 'customer_orders_paid_before_shipping') as paid_in_full_to_ship,
  exists (select 1 from pg_trigger where tgname = 'profiles_protect_customer_credit') as only_admin_changes_it,
  (select count(*) from public.profiles where lower(trim(role)) = 'customer' and erased_at is null and has_credit) as customers_with_credit,
  (select count(*) from public.profiles where lower(trim(role)) = 'customer' and erased_at is null and not has_credit) as customers_without_credit;
