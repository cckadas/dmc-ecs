-- =============================================================================
-- 048: Customers pay in US dollars; suppliers are paid in pesos
--
-- DMC's practice (2026-11-22): DMC buys from its suppliers in pesos and sells
-- to its customers in US dollars. A product's price for a customer is the
-- supplier's peso price divided by the day's exchange rate (pesos per US
-- dollar), plus the country's markup. So:
--   - the exchange rate is the European Central Bank's. The server fetches it
--     by itself (server/exchangeRates.js) and keeps it day by day; nobody
--     types it. DMC's admin, management and sales are told when it changes;
--   - each quotation keeps the rate it was priced with, so its dollar prices
--     don't move during its 7 days, and its order keeps those prices;
--   - container costs are in US dollars: DMC's own (20-ft 6,000, 40-ft and
--     40-ft high cube 11,500), saved on Markups & Credit before this;
--   - shipping costs are charged in US dollars, kept apart from the old ones:
--     each country's simulated peso amount is converted at US$1 = ₱63.777 (the
--     ECB's rate of Nov 20, 2026), still marked simulated, with the peso amount
--     and the rate it came from. The peso amounts stay on record, unused;
--   - credit limits keep their numbers, now in US dollars (only the currency
--     changes, as DMC decided);
--   - what customers were already charged or paid (quotations, orders,
--     payments, refunds, and what they owed when their credit changed), all of
--     it test or made-up records, is converted once at that same rate;
--   - what the system tells customers and sales about money shows US$;
--   - the supplier side stays in pesos: price lists, purchase orders, the
--     suppliers' invoices and DMC's payments, and the cases suppliers owe.
-- Safe to run more than once: the conversion happens only the first time. The
-- last query shows true, true, true, true, then the rate used.
-- =============================================================================


-- 1. The exchange rate, day by day ---------------------------------------------------------
create table if not exists public.exchange_rates (
  rate_date    date primary key,
  php_per_usd  numeric(12, 6) not null check (php_per_usd > 0),
  source       text not null,
  fetched_at   timestamptz not null default now()
);

alter table public.exchange_rates enable row level security;

drop policy if exists "staff: read exchange rates" on public.exchange_rates;
create policy "staff: read exchange rates" on public.exchange_rates
  for select to authenticated
  using ((select public.has_role('admin', 'management', 'sales', 'procurement', 'warehouse')));

-- The rate on the day this was built, so pricing works before the server's
-- first fetch. The server adds each new day's.
insert into public.exchange_rates (rate_date, php_per_usd, source)
values ('2026-11-20', 63.777, 'European Central Bank (via Frankfurter)')
on conflict (rate_date) do nothing;

-- Today's rate: the latest one kept.
create or replace function public.current_exchange_rate()
returns table (rate_date date, php_per_usd numeric, fetched_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select e.rate_date, e.php_per_usd, e.fetched_at
  from exchange_rates e
  order by e.rate_date desc
  limit 1
$$;

revoke execute on function public.current_exchange_rate() from public, anon;
grant execute on function public.current_exchange_rate() to authenticated;

-- The server's step: keeps a day's rate, and tells DMC's staff when it changed.
create or replace function public.record_exchange_rate(p_date date, p_rate numeric, p_source text default 'European Central Bank (via Frankfurter)')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before   exchange_rates%rowtype;
  v_rate     numeric := round(p_rate, 6);
  v_changed  boolean;
begin
  if p_date is null or p_rate is null or p_rate <= 0 then
    raise exception 'An exchange rate needs its date and a rate above 0.';
  end if;

  select * into v_before from exchange_rates order by rate_date desc limit 1;

  insert into exchange_rates (rate_date, php_per_usd, source, fetched_at)
  values (p_date, v_rate, coalesce(nullif(trim(p_source), ''), 'European Central Bank (via Frankfurter)'), now())
  on conflict (rate_date) do update
    set php_per_usd = excluded.php_per_usd,
        source = excluded.source,
        fetched_at = excluded.fetched_at;

  -- A newer rate than the last one, or the same day's corrected.
  v_changed := v_before.rate_date is null
    or (p_date >= v_before.rate_date and v_rate <> v_before.php_per_usd);

  if v_changed then
    begin
      insert into notifications (user_id, role, title, message, type, link)
      select (select p.id from profiles p where lower(trim(p.role)) = r.role order by p.created_at limit 1),
             r.role,
             format('Exchange rate: US$1 = ₱%s', to_char(round(v_rate, 2), 'FM999,990.00')),
             format('The European Central Bank''s rate for %s is ₱%s per US dollar%s. New quotations are priced with it; quotations already sent keep their own.',
               to_char(p_date, 'FMMon FMDD, YYYY'), to_char(round(v_rate, 4), 'FM999,990.0000'),
               case when v_before.rate_date is not null
                 then format(' (it was ₱%s)', to_char(round(v_before.php_per_usd, 4), 'FM999,990.0000'))
                 else '' end),
             'info', r.link
      from (values ('admin', '/pricing-credit'), ('management', '/pricing-credit'), ('sales', '/pfi-builder')) as r(role, link)
      where exists (select 1 from profiles p where lower(trim(p.role)) = r.role);
    exception when foreign_key_violation then
      null;
    end;
  end if;

  return jsonb_build_object('rate_date', p_date, 'php_per_usd', v_rate, 'changed', v_changed);
end;
$$;

revoke execute on function public.record_exchange_rate(date, numeric, text) from public, anon, authenticated;
grant execute on function public.record_exchange_rate(date, numeric, text) to service_role;


-- 2. A quotation keeps the rate it was priced with ----------------------------------------
alter table public.quotations
  add column if not exists php_per_usd numeric(12, 6),
  add column if not exists rate_date date;


-- 3. Shipping costs in US dollars, kept apart from the old peso ones ----------------------
alter table public.market_markups
  add column if not exists shipping_cost_usd numeric(12, 2),
  add column if not exists shipping_php_before numeric(12, 2),
  add column if not exists shipping_converted_rate numeric(12, 6),
  add column if not exists shipping_converted_on date;

alter table public.market_markups drop constraint if exists market_markups_shipping_usd_not_negative;
alter table public.market_markups add constraint market_markups_shipping_usd_not_negative
  check (shipping_cost_usd is null or shipping_cost_usd >= 0);

-- Saving a country's dollar shipping cost makes it DMC's own (as in 030).
drop trigger if exists market_markups_saved on public.market_markups;
create trigger market_markups_saved
  before update of markup_percent, shipping_cost, shipping_cost_usd on public.market_markups
  for each row execute function public.markup_saved_by_staff();


-- 4. Pricing a quotation in US dollars -------------------------------------------------------
-- As in 044, with the container costs and the country's shipping cost in US
-- dollars, and the exchange rate kept: today's when the quotation is made
-- (refused if the screen priced it at another one), never changed after.
create or replace function public.set_quotation_charges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country     text;
  v_container   numeric := 0;
  v_shipping    numeric;
  v_units       integer := 0;
  v_entry       jsonb;
  v_size        container_sizes%rowtype;
  v_count       integer;
  v_plan        jsonb := '[]'::jsonb;
  v_big_code    text;
  v_big_order   integer;
  v_rate        numeric;
  v_rate_date   date;
begin
  if tg_op = 'INSERT' then
    select c.php_per_usd, c.rate_date into v_rate, v_rate_date from public.current_exchange_rate() c;

    if v_rate is null then
      raise exception 'There is no exchange rate yet, so nothing can be priced in US dollars. The server fetches it from the European Central Bank: check that it is running.';
    end if;

    if new.php_per_usd is null and auth.uid() is not null then
      raise exception 'This screen still prices in pesos. Reload the page, then price the quotation again.';
    end if;

    if new.php_per_usd is not null and round(new.php_per_usd, 6) <> round(v_rate, 6) then
      raise exception 'The exchange rate changed to ₱% per US dollar after you opened this form. Nothing was saved: open it again to price it at today''s rate.', to_char(v_rate, 'FM999,990.0000');
    end if;

    new.php_per_usd := v_rate;
    new.rate_date := v_rate_date;
  else
    new.php_per_usd := old.php_per_usd;
    new.rate_date := old.rate_date;
  end if;

  -- Without a plan: one container of the size chosen, as before.
  if new.container_plan is null
     or jsonb_typeof(new.container_plan) <> 'array'
     or jsonb_array_length(new.container_plan) = 0 then
    if new.container_size is null then
      raise exception 'Choose the container for this quotation.';
    end if;
    new.container_plan := jsonb_build_array(jsonb_build_object('code', new.container_size, 'count', 1));
  end if;

  for v_entry in select * from jsonb_array_elements(new.container_plan) loop
    v_count := nullif(v_entry ->> 'count', '')::integer;

    if v_count is null or v_count <= 0 then
      raise exception 'Each container size in the quotation needs a number of containers above 0.';
    end if;

    select * into v_size from container_sizes where code = v_entry ->> 'code';

    if not found then
      raise exception 'There is no % container.', v_entry ->> 'code';
    end if;

    if v_size.cost is null then
      raise exception 'The % container has no cost yet. Admin or management must set it in Markups & Credit.', v_size.code;
    end if;

    v_container := v_container + v_size.cost * v_count;
    v_units := v_units + v_count;
    v_plan := v_plan || jsonb_build_object('code', v_size.code, 'name', v_size.name, 'count', v_count, 'cost', v_size.cost);

    if v_big_code is null or coalesce(v_size.sort_order, 0) > v_big_order then
      v_big_code := v_size.code;
      v_big_order := coalesce(v_size.sort_order, 0);
    end if;
  end loop;

  select l.country into v_country
  from quotation_requests r
  left join delivery_locations l on l.id = r.delivery_location_id
  where r.id = new.quotation_request_id;

  -- The country's own row, or the Default row for a country without one.
  select m.shipping_cost_usd into v_shipping
  from market_markups m
  where lower(trim(m.country)) in (lower(trim(coalesce(v_country, ''))), 'default')
  order by lower(trim(m.country)) = 'default'
  limit 1;

  if v_shipping is null then
    raise exception 'There is no shipping cost in US dollars for % yet. Admin or management must set it in Markups & Credit.', coalesce(v_country, 'this country');
  end if;

  new.container_plan := v_plan;
  new.container_size := v_big_code;
  new.container_cost := v_container;
  new.shipping_cost := v_shipping * v_units;
  new.total_amount := coalesce(new.subtotal, 0) + v_container + v_shipping * v_units;
  new.down_payment_amount := round(new.total_amount * 0.5, 2);

  return new;
end;
$$;

drop trigger if exists quotations_charges on public.quotations;
create trigger quotations_charges
  before insert or update of container_size, container_plan, container_cost, shipping_cost, subtotal, total_amount, down_payment_amount, php_per_usd, rate_date
  on public.quotations
  for each row execute function public.set_quotation_charges();


-- 5. Converting what was already in pesos, once ---------------------------------------------
create table if not exists public.currency_conversions (
  id           bigint generated always as identity primary key,
  php_per_usd  numeric(12, 6) not null,
  rate_date    date not null,
  done_at      timestamptz not null default now(),
  note         text
);

alter table public.currency_conversions enable row level security;

drop policy if exists "staff: read currency conversions" on public.currency_conversions;
create policy "staff: read currency conversions" on public.currency_conversions
  for select to authenticated
  using ((select public.has_role('admin', 'management', 'sales')));

do $$
declare
  c_rate       constant numeric := 63.777;
  c_rate_date  constant date := '2026-11-20';
begin
  if exists (select 1 from public.currency_conversions) then
    return;  -- already converted
  end if;

  -- Each amount on its own, to the cent, so amounts that were equal (paid in
  -- full, a down payment paid exactly) stay equal. The guards and records on
  -- these tables are paused while it happens: nothing here is a new payment,
  -- price or step.
  alter table public.quotations disable trigger user;
  alter table public.quotation_items disable trigger user;
  alter table public.customer_orders disable trigger user;
  alter table public.customer_order_items disable trigger user;
  alter table public.customer_order_payment_history disable trigger user;
  alter table public.customer_credit_changes disable trigger user;
  alter table public.market_markups disable trigger user;

  update public.quotations
  set subtotal = round(subtotal / c_rate, 2),
      shipping_cost = round(shipping_cost / c_rate, 2),
      container_cost = round(container_cost / c_rate, 2),
      total_amount = round(total_amount / c_rate, 2),
      down_payment_amount = round(down_payment_amount / c_rate, 2),
      container_plan = (
        select jsonb_agg(case when jsonb_typeof(e -> 'cost') = 'number'
                              then jsonb_set(e, '{cost}', to_jsonb(round((e ->> 'cost')::numeric / c_rate, 2)))
                              else e end order by n)
        from jsonb_array_elements(container_plan) with ordinality as x(e, n)
      ),
      php_per_usd = c_rate,
      rate_date = c_rate_date;

  update public.quotation_items
  set unit_price = round(unit_price / c_rate, 2),
      subtotal = round(quantity * round(unit_price / c_rate, 2), 2);

  update public.customer_orders
  set subtotal = round(subtotal / c_rate, 2),
      shipping_cost = round(shipping_cost / c_rate, 2),
      container_cost = round(container_cost / c_rate, 2),
      total_amount = round(total_amount / c_rate, 2),
      down_payment_amount = round(down_payment_amount / c_rate, 2),
      settled_amount = round(settled_amount / c_rate, 2),
      pending_payment_amount = round(pending_payment_amount / c_rate, 2),
      missing_goods_amount = round(missing_goods_amount / c_rate, 2),
      refunded_amount = round(refunded_amount / c_rate, 2),
      container_plan = (
        select jsonb_agg(case when jsonb_typeof(e -> 'cost') = 'number'
                              then jsonb_set(e, '{cost}', to_jsonb(round((e ->> 'cost')::numeric / c_rate, 2)))
                              else e end order by n)
        from jsonb_array_elements(container_plan) with ordinality as x(e, n)
      );

  update public.customer_order_items
  set unit_price = round(unit_price / c_rate, 2),
      subtotal = round(quantity * round(unit_price / c_rate, 2), 2);

  update public.customer_order_payment_history
  set amount = round(amount / c_rate, 2);

  -- Credit limits keep their numbers (only the currency changes); what the
  -- customer owed then is an amount they were charged.
  update public.customer_credit_changes
  set owed_then = round(owed_then / c_rate, 2);

  -- Shipping: the dollar amount, and where it came from. The rows stay marked
  -- simulated (the rule that clears the mark is paused above).
  update public.market_markups
  set shipping_cost_usd = round(shipping_cost / c_rate, 2),
      shipping_php_before = shipping_cost,
      shipping_converted_rate = c_rate,
      shipping_converted_on = c_rate_date
  where shipping_cost is not null
    and shipping_cost_usd is null;

  alter table public.quotations enable trigger user;
  alter table public.quotation_items enable trigger user;
  alter table public.customer_orders enable trigger user;
  alter table public.customer_order_items enable trigger user;
  alter table public.customer_order_payment_history enable trigger user;
  alter table public.customer_credit_changes enable trigger user;
  alter table public.market_markups enable trigger user;

  insert into public.currency_conversions (php_per_usd, rate_date, note)
  values (c_rate, c_rate_date, 'Every amount customers were charged or paid, and the simulated shipping costs, divided by this rate and rounded to the cent (048).');
end;
$$;


-- 6. What customers and sales are told shows US$ -------------------------------------------
-- These steps only speak of what customers are charged, paid or owe. The
-- supplier side (purchase orders, the suppliers' amounts) keeps ₱.
do $$
declare
  v_fn   record;
  v_def  text;
begin
  for v_fn in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'apply_payment_deadlines', 'approve_quotation', 'check_paid_before_shipping', 'customer_account_step',
        'enforce_credit_limit', 'enforce_credit_limit_on_order', 'hold_request_for_credit', 'record_order_refund',
        'refuse_quotation_over_credit', 'review_order_payment', 'set_customer_credit', 'take_missing_goods_off',
        'tell_customer_to_pay_before_shipping', 'tell_sales_credit_room'])
      and position('₱' in p.prosrc) > 0
  loop
    v_def := pg_get_functiondef(v_fn.oid);
    execute replace(v_def, '₱', 'US$');
  end loop;
end;
$$;


-- Check: true, true, true, true, then the rate the old amounts were converted at.
select
  to_regprocedure('public.record_exchange_rate(date, numeric, text)') is not null as rate_kept_day_by_day,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'quotations' and column_name = 'php_per_usd') as quotation_keeps_its_rate,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'market_markups' and column_name = 'shipping_cost_usd') as shipping_in_dollars,
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosrc like '%₱%'
                and p.proname in ('approve_quotation', 'enforce_credit_limit_on_order', 'set_customer_credit', 'take_missing_goods_off', 'record_order_refund')) as customers_told_in_dollars,
  (select php_per_usd from public.currency_conversions order by done_at limit 1) as converted_at_rate;
