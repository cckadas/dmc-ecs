-- =============================================================================
-- 042: The database names each quotation request; an order's location is fixed
--
-- 1. A request's reference (REF- and 6 letters or digits) was made by the
--    customer's browser, so a customer could send any reference they liked,
--    and two could in theory match (the database refused a repeat with a
--    technical error). The database now makes it, ignoring what is sent, and
--    never repeats one. Nobody signed in can change a reference afterwards.
--    Requests saved by DMC's own scripts (no one signed in), such as the
--    made-up history, keep the reference they give.
-- 2. DMC's rule (2026-11-22): once a quotation is approved, the order keeps the
--    delivery location it was approved with; a different location is only for
--    new requests. 037 already works that way; its message no longer tells
--    the customer to contact DMC about it.
-- Safe to run more than once. The last query shows true, true.
-- =============================================================================


-- 1. The reference, made by the database ---------------------------------------------------
create or replace function public.assign_request_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c_chars constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  v_ref   text;
begin
  -- DMC's own scripts (no one signed in) keep the reference they give.
  if auth.uid() is null and nullif(trim(new.quotation_reference), '') is not null then
    return new;
  end if;

  loop
    select 'REF-' || string_agg(substr(c_chars, 1 + floor(random() * 36)::integer, 1), '')
    into v_ref
    from generate_series(1, 6);
    exit when not exists (select 1 from quotation_requests where quotation_reference = v_ref);
  end loop;

  new.quotation_reference := v_ref;
  return new;
end;
$$;

revoke execute on function public.assign_request_reference() from public, anon, authenticated;

drop trigger if exists quotation_requests_reference on public.quotation_requests;
create trigger quotation_requests_reference
  before insert on public.quotation_requests
  for each row execute function public.assign_request_reference();

-- ...and kept as it is.
create or replace function public.keep_request_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.quotation_reference is distinct from old.quotation_reference and auth.uid() is not null then
    raise exception 'A request''s reference is set by the system and can''t be changed.';
  end if;
  return new;
end;
$$;

revoke execute on function public.keep_request_reference() from public, anon, authenticated;

drop trigger if exists quotation_requests_keep_reference on public.quotation_requests;
create trigger quotation_requests_keep_reference
  before update of quotation_reference on public.quotation_requests
  for each row execute function public.keep_request_reference();


-- 2. Changing a request's delivery location ---------------------------------------------------
-- As in 037; an order's location stays the one it was approved with.
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
    raise exception 'This request is an order now (%), and an order keeps the delivery location it was approved with. A different location can be used for your new requests.', coalesce(v_order, 'its order');
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


-- Check: true, true.
select
  (select count(*) from pg_trigger
   where tgrelid = 'public.quotation_requests'::regclass
     and tgname in ('quotation_requests_reference', 'quotation_requests_keep_reference')) = 2 as references_by_the_database,
  position('keeps the delivery location it was approved with' in pg_get_functiondef('public.change_request_location(uuid, uuid)'::regprocedure)) > 0 as order_location_fixed;
