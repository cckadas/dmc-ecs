-- =============================================================================
-- 037: The customer changes a quotation request's delivery location
--
-- A request's prices go by its delivery country (markup and shipping), and
-- its PFI shows the address. Since 036 a saved location in use can't be
-- edited, so a request that should go somewhere else is changed here, by its
-- customer, before it becomes an order:
--   - not priced yet ("awaiting pricing"): the request just gets the new
--     location, and DMC prices it for that;
--   - priced, its quotation waiting for the customer's answer: the quotation
--     is withdrawn (kept on record, it can't be approved any more) and the
--     request goes back to DMC to be priced again for the new location, even
--     in the same country (its PFI shows the address);
--   - an order already, answered, cancelled or expired: refused, saying what
--     to do instead (an expired quotation's "Request a new quote" can choose
--     a new location).
-- Every change is recorded (who, when, from where to where, the quotation
-- withdrawn) for the customer and DMC, and sales is told.
--
-- Also: a request back in "awaiting pricing" has a withdrawn quotation on
-- record, so cancelling it marks it cancelled instead of deleting it.
-- Safe to run more than once. The last query shows true, true, true.
-- =============================================================================


-- 1. The record of each change ----------------------------------------------------------
create table if not exists public.quotation_request_location_changes (
  id uuid primary key default gen_random_uuid(),
  quotation_request_id uuid not null references public.quotation_requests (id) on delete cascade,
  from_location_id uuid references public.delivery_locations (id),
  to_location_id uuid not null references public.delivery_locations (id),
  from_text text,
  to_text text,
  withdrawn_quotation_id uuid references public.quotations (id),
  changed_by uuid not null,
  changed_by_name text,
  changed_at timestamptz not null default now()
);

alter table public.quotation_request_location_changes enable row level security;
revoke insert, update, delete on public.quotation_request_location_changes from anon, authenticated;

drop policy if exists "customer: read own request location changes" on public.quotation_request_location_changes;
create policy "customer: read own request location changes" on public.quotation_request_location_changes
  for select to authenticated
  using (exists (
    select 1 from public.quotation_requests r
    where r.id = quotation_request_id and r.customer_id = auth.uid()
  ));

drop policy if exists "staff: read request location changes" on public.quotation_request_location_changes;
create policy "staff: read request location changes" on public.quotation_request_location_changes
  for select to authenticated
  using ((select public.has_role('admin', 'sales', 'management')));


-- 2. Changing it -------------------------------------------------------------------------
create or replace function public.change_request_location(p_request_id uuid, p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request    quotation_requests%rowtype;
  v_old        delivery_locations%rowtype;
  v_new        delivery_locations%rowtype;
  v_quotation  quotations%rowtype;
  v_order      text;
  v_status     text;
  v_today      date := (now() at time zone 'Asia/Manila')::date;
  v_name       text;
  v_from       text;
  v_to         text;
begin
  -- The request's quotations first, then the request, as approving does.
  perform 1 from quotations where quotation_request_id = p_request_id order by id for update;
  select * into v_request from quotation_requests where id = p_request_id for update;

  if v_request.id is null then
    raise exception 'This request no longer exists.';
  end if;

  if v_request.customer_id is distinct from auth.uid() or public.my_role() is distinct from 'customer' then
    raise exception 'Only the customer who sent this request can change its delivery location.';
  end if;

  select * into v_new from delivery_locations where id = p_location_id;
  if v_new.id is null or v_new.profile_id is distinct from auth.uid() or coalesce(v_new.is_archived, false) then
    raise exception 'Choose one of your saved delivery locations.';
  end if;

  if v_request.delivery_location_id = p_location_id then
    raise exception 'That is already this request''s delivery location.';
  end if;

  v_status := coalesce(lower(trim(v_request.status)), '');

  -- Its quotation waiting for an answer, if any (the newest).
  select * into v_quotation
  from quotations
  where quotation_request_id = p_request_id
    and lower(trim(status)) = 'pending approval'
  order by created_at desc
  limit 1;

  if v_status = 'approved' then
    select o.order_number into v_order
    from customer_orders o
    join quotations q on q.id = o.quotation_id
    where q.quotation_request_id = p_request_id
    order by o.created_at desc
    limit 1;
    raise exception 'This request is an order now (%). Changing where an order goes isn''t possible in the system yet: please contact DMC.', coalesce(v_order, 'its order');
  end if;

  if v_status in ('rejected', 'cancelled') then
    raise exception 'This request was %. Please send a new request instead.', v_status;
  end if;

  if v_status = 'expired' or (v_quotation.id is not null and v_quotation.expiry_date < v_today) then
    raise exception 'Its quotation has expired. Use "Request a new quote" on it: you can choose the new delivery location there.';
  end if;

  if v_status = 'priced & sent to customer' and v_quotation.id is null then
    raise exception 'This request''s quotation has already been answered.';
  end if;

  if v_status not in ('awaiting pricing', 'priced & sent to customer') then
    raise exception 'This request''s delivery location can''t be changed now (it is "%").', v_request.status;
  end if;

  select * into v_old from delivery_locations where id = v_request.delivery_location_id;
  v_from := concat_ws(', ', v_old.location_name, v_old.address, v_old.country);
  v_to := concat_ws(', ', v_new.location_name, v_new.address, v_new.country);
  select name into v_name from profiles where id = auth.uid();

  -- Priced already: the quotation is withdrawn, and DMC prices it again.
  if v_quotation.id is not null then
    update quotations set status = 'withdrawn' where id = v_quotation.id;
  end if;

  update quotation_requests
  set delivery_location_id = p_location_id,
      status = 'awaiting pricing'
  where id = p_request_id;

  insert into quotation_request_location_changes
    (quotation_request_id, from_location_id, to_location_id, from_text, to_text, withdrawn_quotation_id, changed_by, changed_by_name)
  values
    (p_request_id, v_old.id, p_location_id, v_from, v_to, v_quotation.id, auth.uid(), v_name);

  begin
    insert into notifications (user_id, role, title, message, type, link)
    values (
      v_request.customer_id, 'sales',
      case when v_quotation.id is not null
        then format('%s - Delivery location changed: price it again', v_request.quotation_reference)
        else format('%s - Delivery location changed', v_request.quotation_reference)
      end,
      case when v_quotation.id is not null
        then format('The customer changed %s''s delivery location from %s to %s, so %s was withdrawn. Please price the request again for the new location.',
          v_request.quotation_reference, v_from, v_to, v_quotation.quotation_number)
        else format('The customer changed %s''s delivery location from %s to %s before it was priced.',
          v_request.quotation_reference, v_from, v_to)
      end,
      'info', '/pfi-builder'
    );
  exception when foreign_key_violation then
    null;
  end;

  return jsonb_build_object(
    'reference', v_request.quotation_reference,
    'withdrawn', v_quotation.quotation_number,
    'from', v_from,
    'to', v_to
  );
end;
$$;

revoke execute on function public.change_request_location(uuid, uuid) from public, anon;
grant execute on function public.change_request_location(uuid, uuid) to authenticated;


-- 3. Cancelling a request still waiting for pricing ---------------------------------------
-- As before it's deleted, unless a quotation of it is on record (one withdrawn
-- when its location changed): then it's kept, marked cancelled.
create or replace function public.cancel_quotation_request(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request quotation_requests%rowtype;
begin
  select * into v_request from quotation_requests where id = p_request_id for update;

  if v_request.id is null then
    raise exception 'This request no longer exists.';
  end if;

  if v_request.customer_id is distinct from auth.uid() or public.my_role() is distinct from 'customer' then
    raise exception 'Only the customer who sent this request can cancel it.';
  end if;

  if coalesce(lower(trim(v_request.status)), '') <> 'awaiting pricing' then
    raise exception 'Only a request still waiting for pricing can be cancelled. To decline a quotation, reject it.';
  end if;

  if exists (select 1 from quotations where quotation_request_id = p_request_id) then
    update quotation_requests set status = 'cancelled' where id = p_request_id;
    return 'cancelled';
  end if;

  delete from quotation_request_items where quotation_request_id = p_request_id;
  delete from quotation_requests where id = p_request_id;
  return 'deleted';
end;
$$;

revoke execute on function public.cancel_quotation_request(uuid) from public, anon;
grant execute on function public.cancel_quotation_request(uuid) to authenticated;


-- Check: true, true, true.
select
  to_regprocedure('public.change_request_location(uuid, uuid)') is not null as change_location_step,
  to_regprocedure('public.cancel_quotation_request(uuid)') is not null as cancel_keeps_records,
  to_regclass('public.quotation_request_location_changes') is not null as changes_recorded;
