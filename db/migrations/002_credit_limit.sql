-- =============================================================================
-- 002 — Customer credit limit
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm). Safe to re-run.
--
-- A customer's unpaid balance is what they still owe on all their orders
-- (total minus amount paid). Once it reaches DMC's credit limit, the customer
-- cannot send a new quotation request or approve a quotation into an order
-- until they pay.
--
-- business_settings   DMC-wide values set by admin and management. Holds the
--                     'credit_limit' (a placeholder until DMC gives the figure).
-- credit_status()     a customer's unpaid balance, the limit, and whether new
--                     orders are blocked — for the screens to show.
-- enforce_credit_limit  triggers on quotation_requests and customer_orders, so
--                     the limit holds even if a screen's own check is skipped.
--
-- NOTE: the write policy checks profiles.role, and profiles has row-level
-- security switched off — see the note in 001.
-- =============================================================================


-- Business settings -----------------------------------------------------------
create table if not exists public.business_settings (
  key         text primary key,
  value       numeric(14, 2),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);

insert into public.business_settings (key, value)
values ('credit_limit', 500000)
on conflict (key) do nothing;

alter table public.business_settings enable row level security;

-- Customers read it too: their screens show how close they are to the limit.
drop policy if exists "business settings readable by signed-in users" on public.business_settings;
create policy "business settings readable by signed-in users" on public.business_settings
  for select to authenticated
  using (true);

drop policy if exists "business settings maintained by admin and management" on public.business_settings;
create policy "business settings maintained by admin and management" on public.business_settings
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'management')
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'management')
  ));


-- Unpaid balance --------------------------------------------------------------
-- Internal: callable only from the functions below, which check who is asking.
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
$$;

revoke execute on function public.customer_outstanding_balance(uuid) from public, anon, authenticated;


-- Credit status, for the screens ----------------------------------------------
-- A customer can ask about themselves; admin, management and sales about anyone.
create or replace function public.credit_status(p_customer_id uuid)
returns table (outstanding numeric, credit_limit numeric, blocked boolean)
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
  select s.value into credit_limit from business_settings s where s.key = 'credit_limit';
  blocked := credit_limit is not null and outstanding >= credit_limit;

  return next;
end;
$$;

revoke execute on function public.credit_status(uuid) from public, anon;
grant execute on function public.credit_status(uuid) to authenticated;


-- Enforcement -----------------------------------------------------------------
create or replace function public.enforce_credit_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit        numeric;
  v_outstanding  numeric;
begin
  select value into v_limit from business_settings where key = 'credit_limit';

  if v_limit is null then
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

drop trigger if exists quotation_requests_credit_limit on public.quotation_requests;
create trigger quotation_requests_credit_limit
  before insert on public.quotation_requests
  for each row execute function public.enforce_credit_limit();

drop trigger if exists customer_orders_credit_limit on public.customer_orders;
create trigger customer_orders_credit_limit
  before insert on public.customer_orders
  for each row execute function public.enforce_credit_limit();


-- Check -----------------------------------------------------------------------
-- Expect: credit_limit 500000.00, and two triggers.
-- select key, value from public.business_settings;
-- select tgname from pg_trigger where tgname like '%credit_limit';
