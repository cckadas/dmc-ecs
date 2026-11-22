-- =============================================================================
-- 050: DMC's container and shipping costs are in pesos
--
-- DMC gives its costs in pesos (2026-11-23): the container costs (20-ft
-- ₱6,000; 40-ft and 40-ft high cube ₱11,500) and each country's shipping cost.
-- Customers pay in US dollars, so a quotation converts them at the same
-- exchange rate it converts the product prices at (048), and keeps that rate:
--   container = the size's peso cost ÷ the rate, for each container;
--   shipping  = the country's peso cost ÷ the rate, for each container.
-- The peso shipping costs are the ones kept before 048 (still marked
-- simulated where they were). Quotations made since 048 and still waiting for
-- an answer are priced again this way, at their own rate.
-- Safe to run more than once. The last query shows true, how many waiting
-- quotations were priced again, and any order made since 048 to look at.
-- =============================================================================


-- 1. Shipping saved in dollars since 048 goes back to pesos, at that rate ---------------
-- (Only rows someone saved in dollars on the screen; the others keep their pesos.)
update public.market_markups m
set shipping_cost = round(m.shipping_cost_usd * coalesce((select c.php_per_usd from public.currency_conversions c order by c.done_at limit 1), 63.777), 2)
where m.shipping_cost_usd is not null
  and m.shipping_converted_rate is null
  and m.shipping_cost is distinct from round(m.shipping_cost_usd * coalesce((select c.php_per_usd from public.currency_conversions c order by c.done_at limit 1), 63.777), 2);


-- 2. Pricing a quotation: DMC's peso costs at the quotation's rate ----------------------
-- As in 048, with the container and shipping costs in pesos, converted at the
-- rate the quotation is priced at (today's when it's made, its own after).
create or replace function public.set_quotation_charges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country       text;
  v_container     numeric := 0;
  v_shipping_php  numeric;
  v_shipping      numeric;
  v_units         integer := 0;
  v_entry         jsonb;
  v_size          container_sizes%rowtype;
  v_size_usd      numeric;
  v_count         integer;
  v_plan          jsonb := '[]'::jsonb;
  v_big_code      text;
  v_big_order     integer;
  v_rate          numeric;
  v_rate_date     date;
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
    v_rate := old.php_per_usd;

    if v_rate is null then
      select c.php_per_usd into v_rate from public.current_exchange_rate() c;
      new.php_per_usd := v_rate;
    end if;
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

    -- The peso cost in US dollars at the quotation's rate.
    v_size_usd := round(v_size.cost / v_rate, 2);

    v_container := v_container + v_size_usd * v_count;
    v_units := v_units + v_count;
    v_plan := v_plan || jsonb_build_object('code', v_size.code, 'name', v_size.name, 'count', v_count, 'cost', v_size_usd, 'cost_php', v_size.cost);

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
  select m.shipping_cost into v_shipping_php
  from market_markups m
  where lower(trim(m.country)) in (lower(trim(coalesce(v_country, ''))), 'default')
  order by lower(trim(m.country)) = 'default'
  limit 1;

  if v_shipping_php is null then
    raise exception 'There is no shipping cost for % yet. Admin or management must set it in Markups & Credit.', coalesce(v_country, 'this country');
  end if;

  v_shipping := round(v_shipping_php / v_rate, 2);

  new.container_plan := v_plan;
  new.container_size := v_big_code;
  new.container_cost := v_container;
  new.shipping_cost := v_shipping * v_units;
  new.total_amount := coalesce(new.subtotal, 0) + v_container + v_shipping * v_units;
  new.down_payment_amount := round(new.total_amount * 0.5, 2);

  return new;
end;
$$;


-- 3. Quotations made since 048 and still waiting: priced again this way ------------------
-- At their own rate (touching the container list makes the step above run).
update public.quotations q
set container_plan = q.container_plan
where lower(trim(q.status)) = 'pending approval'
  and q.created_at > (select min(c.done_at) from public.currency_conversions c);


-- Check: true, how many waiting quotations were priced again, and any order made since 048.
select
  position('/ v_rate' in pg_get_functiondef('public.set_quotation_charges()'::regprocedure)) > 0 as costs_in_pesos_converted,
  (select count(*) from public.quotations q
   where lower(trim(q.status)) = 'pending approval'
     and q.created_at > (select min(c.done_at) from public.currency_conversions c)) as waiting_quotations_priced_again,
  coalesce((select string_agg(o.order_number, ', ' order by o.order_number)
            from public.customer_orders o
            join public.quotations q on q.id = o.quotation_id
            where q.created_at > (select min(c.done_at) from public.currency_conversions c)), 'none') as orders_made_since_048;
