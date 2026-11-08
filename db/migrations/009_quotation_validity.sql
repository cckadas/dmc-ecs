-- =============================================================================
-- 009 — A quotation is valid for exactly 7 days, Sundays not counted
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm). Safe to re-run.
--
-- DMC's rule (confirmed by DMC, Oct 2026): a quotation expires 7 days after
-- the day it's generated, not counting Sundays. It's fixed, not chosen, so
-- staff can't set it wrong: the database sets the expiry date itself when a
-- quotation is saved, ignoring whatever the screen sent, and refuses any
-- later change to it. "Today" is Philippine time, so the date is right even
-- between midnight and 8 a.m. (when the UTC date is a day behind).
-- =============================================================================

-- The expiry date for a quotation generated on p_from.
create or replace function public.quotation_latest_expiry(p_from date)
returns date
language plpgsql
immutable
as $$
declare
  v_date     date := p_from;
  v_counted  integer := 0;
begin
  while v_counted < 7 loop
    v_date := v_date + 1;
    if extract(isodow from v_date) <> 7 then   -- 7 = Sunday
      v_counted := v_counted + 1;
    end if;
  end loop;

  return v_date;
end;
$$;


create or replace function public.enforce_quotation_expiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.expiry_date := quotation_latest_expiry((now() at time zone 'Asia/Manila')::date);
  elsif new.expiry_date is distinct from old.expiry_date then
    raise exception 'A quotation''s expiry date is fixed at 7 days (Sundays not counted) and can''t be changed.';
  end if;

  return new;
end;
$$;

drop trigger if exists quotations_expiry_rule on public.quotations;
create trigger quotations_expiry_rule
  before insert or update of expiry_date on public.quotations
  for each row execute function public.enforce_quotation_expiry();


-- Check -----------------------------------------------------------------------
-- Expect the expiry date for a quotation made today, e.g. Sun Oct 25 2026
-- -> Mon Nov 2 2026.
-- select public.quotation_latest_expiry((now() at time zone 'Asia/Manila')::date);
