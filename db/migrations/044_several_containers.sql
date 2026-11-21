-- =============================================================================
-- 044: An order too big for one 40-ft high cube ships in several containers
--
-- DMC's rule (2026-11-22), in place of "an order must fit in one container":
-- the order fills as many 40-ft high cubes as it needs, then what's left goes
-- in the smallest size that holds it (20-ft, then 40-ft, then 40-ft high cube),
-- by volume and weight. The PFI Builder works the containers out. Each one
-- pays its own container cost AND the destination's shipping cost (shipping
-- lines charge per container). All of an order's containers ship together,
-- once, when everything is in and labeled, as an order ships now.
--
-- quotations.container_plan and customer_orders.container_plan list the
-- containers, biggest first:
--   [{"code": "40-ft HC", "name": "40-ft high cube", "count": 2, "cost": 130000}, ...]
-- container_size stays the biggest one's code, so every screen and estimate
-- that reads one size keeps working. The database prices the containers and
-- the shipping itself from the plan, as it did for one container; a quotation
-- saved without a plan is one container of its size, as before.
-- Needs 016, 040 and 041. Safe to run more than once. The last query shows
-- true, true.
-- =============================================================================


-- 1. The containers of a quotation, and of its order --------------------------------------------
alter table public.quotations add column if not exists container_plan jsonb;
alter table public.customer_orders add column if not exists container_plan jsonb;


-- 2. Pricing them: each container's cost, and shipping per container ---------------------------
-- As in 016, for a list of containers.
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
begin
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
  select m.shipping_cost into v_shipping
  from market_markups m
  where lower(trim(m.country)) in (lower(trim(coalesce(v_country, ''))), 'default')
  order by lower(trim(m.country)) = 'default'
  limit 1;

  if v_shipping is null then
    raise exception 'There is no shipping cost for % yet. Admin or management must set it in Markups & Credit.', coalesce(v_country, 'this country');
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
  before insert or update of container_size, container_plan, container_cost, shipping_cost, subtotal, total_amount, down_payment_amount
  on public.quotations
  for each row execute function public.set_quotation_charges();


-- 3. Approving a quotation: its order keeps the containers -------------------------------------
-- As in 041, plus container_plan.
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
    container_size, container_plan, container_cost, total_amount, down_payment_amount, delivery_location_id,
    pfi_file_path, expiry_date, status
  )
  values (
    v_number, v_request.customer_id, v_quotation.id, v_quotation.quotation_number,
    v_quotation.subtotal, v_quotation.shipping_cost, v_quotation.container_size, v_quotation.container_plan,
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


-- Check: true, true.
select
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'quotations' and column_name = 'container_plan')
  and exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'customer_orders' and column_name = 'container_plan') as containers_listed,
  position('v_shipping * v_units' in pg_get_functiondef('public.set_quotation_charges()'::regprocedure)) > 0 as shipping_per_container;
