-- =============================================================================
-- 035: Expired quotations — a reminder, marked "Expired", and asked for again
--
-- A quotation can be approved through its expiry date (7 days, Sundays not
-- counted; 009). Until now an unapproved one stayed "pending approval" forever,
-- its request stayed "priced & sent to customer", and the customer was told to
-- "request a refreshed quote" with no way to do it. Now:
--   - 2 days before it expires, the customer is reminded (once);
--   - the day after its expiry date, the quotation and its request are marked
--     "expired", and the customer and sales are told (once);
--   - the customer can ask for a new quote: a new request, filled in from the
--     expired one (they can change it), that says which request it replaces.
--     Sales prices it as any request, with today's prices. A request can be
--     replaced by one new request only, and only the customer's own expired one.
-- The expired quotation and its request stay on record.
--
-- The server runs the step every 5 minutes (server/quotationExpiry.js), as it
-- does the down payment deadlines (028). Safe to run more than once. The last
-- query shows the steps are in place, and which quotations the first run will
-- mark expired.
-- =============================================================================


-- 1. Which request a new one replaces ------------------------------------------------
alter table public.quotation_requests
  add column if not exists replaces_request_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotation_requests_replaces_fkey') then
    alter table public.quotation_requests
      add constraint quotation_requests_replaces_fkey
      foreign key (replaces_request_id) references public.quotation_requests (id) on delete set null;
  end if;
end;
$$;

-- One new request per expired one.
create unique index if not exists quotation_requests_one_new_quote
  on public.quotation_requests (replaces_request_id)
  where replaces_request_id is not null;


-- 2. Only the customer's own expired request can be replaced ------------------------
-- Expired: marked so, or past its quotation's expiry date and not answered (the
-- 5-minute run may not have marked it yet). The link can't be changed later. The
-- server and the SQL editor (no signed-in user) aren't held to it.
create or replace function public.check_request_replaces()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old    quotation_requests%rowtype;
  v_today  date := (now() at time zone 'Asia/Manila')::date;
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.replaces_request_id is distinct from old.replaces_request_id then
      raise exception 'Which request this one replaces can''t be changed.';
    end if;
    return new;
  end if;

  if new.replaces_request_id is null then
    return new;
  end if;

  select * into v_old from quotation_requests where id = new.replaces_request_id;

  if v_old.id is null or v_old.customer_id is distinct from new.customer_id then
    raise exception 'A new quote can only be asked for in place of your own request.';
  end if;

  if coalesce(lower(trim(v_old.status)), '') <> 'expired'
     and not exists (
       select 1 from quotations q
       where q.quotation_request_id = v_old.id
         and lower(trim(q.status)) in ('pending approval', 'expired')
         and q.expiry_date < v_today
     ) then
    raise exception 'A new quote can only be asked for when %''s quotation has expired.', v_old.quotation_reference;
  end if;

  return new;
end;
$$;

revoke execute on function public.check_request_replaces() from public, anon, authenticated;

drop trigger if exists quotation_requests_replaces on public.quotation_requests;
create trigger quotation_requests_replaces
  before insert or update on public.quotation_requests
  for each row execute function public.check_request_replaces();


-- 3. Each reminder and expiry is told once ------------------------------------------------
create table if not exists public.quotation_expiry_notices (
  quotation_id uuid not null references public.quotations (id) on delete cascade,
  kind text not null check (kind in ('reminder', 'expired')),
  expiry_date date not null,
  sent_at timestamptz not null default now(),
  primary key (quotation_id, kind, expiry_date)
);

alter table public.quotation_expiry_notices enable row level security;
revoke all on public.quotation_expiry_notices from anon, authenticated;


-- 4. The step the server runs every 5 minutes ---------------------------------------------
-- p_today: the day to run as (default: today in the Philippines).
-- p_dry_run: say what would happen, change nothing.
-- Returns { reminders: [quotation numbers], expired: [quotation numbers] }.
create or replace function public.apply_quotation_expiry(p_today date default null, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today      date := coalesce(p_today, (now() at time zone 'Asia/Manila')::date);
  v_row        record;
  v_kind       text;
  v_new        integer;
  v_reminders  jsonb := '[]'::jsonb;
  v_expired    jsonb := '[]'::jsonb;
  c_day        constant text := 'FMMon FMDD, YYYY';
begin
  for v_row in
    select q.id, q.quotation_number, q.expiry_date, r.id as request_id, r.quotation_reference, r.customer_id
    from quotations q
    join quotation_requests r on r.id = q.quotation_request_id
    where coalesce(lower(trim(q.status)), '') = 'pending approval'
      and q.expiry_date is not null
      and v_today >= q.expiry_date - 2
    order by q.expiry_date, q.quotation_number
    for update of q
  loop
    v_kind := case when v_today > v_row.expiry_date then 'expired' else 'reminder' end;

    -- A reminder already sent isn't sent again (an expiry can't be: it's no
    -- longer pending approval afterwards).
    if v_kind = 'reminder' and exists (
      select 1 from quotation_expiry_notices n
      where n.quotation_id = v_row.id and n.kind = 'reminder' and n.expiry_date = v_row.expiry_date
    ) then
      continue;
    end if;

    if p_dry_run then
      if v_kind = 'expired' then
        v_expired := v_expired || to_jsonb(v_row.quotation_number);
      else
        v_reminders := v_reminders || to_jsonb(v_row.quotation_number);
      end if;
      continue;
    end if;

    insert into quotation_expiry_notices (quotation_id, kind, expiry_date)
    values (v_row.id, v_kind, v_row.expiry_date)
    on conflict (quotation_id, kind, expiry_date) do nothing;
    get diagnostics v_new = row_count;
    if v_new = 0 then
      continue;
    end if;

    if v_kind = 'expired' then
      update quotations set status = 'expired' where id = v_row.id;

      update quotation_requests
      set status = 'expired'
      where id = v_row.request_id
        and coalesce(lower(trim(status)), '') = 'priced & sent to customer';

      begin
        insert into notifications (user_id, role, title, message, type, link)
        values
          (v_row.customer_id, 'customer',
           format('%s - Quotation expired', v_row.quotation_number),
           format('Your quotation %s (%s) expired on %s without being approved, so it can''t be approved any more. To order these products, open it in Quotation Requests and click "Request a new quote": your products are filled in for you, and DMC prices them again.',
             v_row.quotation_number, v_row.quotation_reference, to_char(v_row.expiry_date, c_day)),
           'warning', '/quotation-requests'),
          (v_row.customer_id, 'sales',
           format('%s - Expired without approval', v_row.quotation_number),
           format('%s (%s) expired on %s without the customer''s approval. If they ask for a new quote, it comes in as a new request that names %s.',
             v_row.quotation_number, v_row.quotation_reference, to_char(v_row.expiry_date, c_day), v_row.quotation_reference),
           'info', '/pfi-builder');
      exception when foreign_key_violation then
        null;
      end;

      v_expired := v_expired || to_jsonb(v_row.quotation_number);
    else
      begin
        insert into notifications (user_id, role, title, message, type, link)
        values
          (v_row.customer_id, 'customer',
           format('%s - Expires on %s', v_row.quotation_number, to_char(v_row.expiry_date, c_day)),
           format('Your quotation %s (%s) can be approved until %s. After that it expires, and a new quote has to be requested.',
             v_row.quotation_number, v_row.quotation_reference, to_char(v_row.expiry_date, c_day)),
           'info', '/quotation-requests');
      exception when foreign_key_violation then
        null;
      end;

      v_reminders := v_reminders || to_jsonb(v_row.quotation_number);
    end if;
  end loop;

  return jsonb_build_object('reminders', v_reminders, 'expired', v_expired);
end;
$$;

revoke execute on function public.apply_quotation_expiry(date, boolean) from public, anon, authenticated;
grant execute on function public.apply_quotation_expiry(date, boolean) to service_role;


-- Check: the steps are in place (expect true, true, true), and what the first
-- run will do (it runs within 5 minutes of the server noticing this script).
select
  to_regprocedure('public.apply_quotation_expiry(date, boolean)') is not null as expiry_step,
  exists (select 1 from pg_trigger where tgname = 'quotation_requests_replaces') as new_quote_guard,
  to_regclass('public.quotation_expiry_notices') is not null as notices_recorded,
  coalesce((select string_agg(value, ', ') from jsonb_array_elements_text(public.apply_quotation_expiry(null, true) -> 'expired')), 'none') as expire_at_first_run,
  coalesce((select string_agg(value, ', ') from jsonb_array_elements_text(public.apply_quotation_expiry(null, true) -> 'reminders')), 'none') as remind_at_first_run;
