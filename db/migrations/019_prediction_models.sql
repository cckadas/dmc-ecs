-- =============================================================================
-- 019 — The prediction model's saved weights
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm), after 018.
-- Safe to re-run. All or nothing: if any line fails, nothing is changed.
--
-- The TensorFlow.js model learns two step times on the Predictive Analytics
-- page: how early or late a supplier delivers, and how long labeling takes.
-- Its trained numbers (weights) are saved here, with how well it did and
-- whether it's in use (it is only when it beat the statistics on orders it
-- didn't learn from). Every screen and the server read them and do the final
-- arithmetic, so they all give the same date.
--
-- Staff read it, since staff pages work out estimates themselves; admin and
-- management save it (Retrain). Customers can't: their estimates come from the
-- server.
--
-- Also: the status history for the estimates now comes in a fixed order, so
-- it can be read a page at a time once it passes the API's 1,000 rows.
-- =============================================================================

begin;


create table if not exists public.prediction_models (
  key         text primary key check (key in ('supplier_lateness', 'labeling_days')),
  weights     jsonb not null,
  spec        jsonb not null,
  metrics     jsonb not null,
  in_use      boolean not null default false,
  trained_at  timestamptz not null default now(),
  trained_by  uuid references public.profiles (id) on delete set null
);

alter table public.prediction_models enable row level security;

drop policy if exists "staff: read prediction models" on public.prediction_models;
create policy "staff: read prediction models" on public.prediction_models
  for select to authenticated
  using ((select public.has_role('admin', 'management', 'sales', 'procurement', 'warehouse')));

drop policy if exists "admin and management: save prediction models" on public.prediction_models;
create policy "admin and management: save prediction models" on public.prediction_models
  for all to authenticated
  using ((select public.has_role('admin', 'management')))
  with check ((select public.has_role('admin', 'management')));


-- The status history for the estimates, in a fixed order -----------------------
-- As in 013, with the row's id as a tie-breaker: changes saved together share a
-- time, and reading a page at a time needs one order every time.
create or replace function public.status_history_for_estimates()
returns table (customer_order_id uuid, previous_status text, new_status text, changed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when public.my_role() <> 'customer' or o.customer_id = auth.uid() then h.customer_order_id
      else md5(h.customer_order_id::text)::uuid
    end,
    h.previous_status,
    h.new_status,
    h.changed_at
  from customer_order_status_history h
  join customer_orders o on o.id = h.customer_order_id
  where public.my_role() is not null
  order by h.changed_at, h.id
$$;

revoke execute on function public.status_history_for_estimates() from public, anon;
grant execute on function public.status_history_for_estimates() to authenticated;


commit;


-- Check -----------------------------------------------------------------------
-- Expect one row: row level security on, 2 policies, 0 models saved yet.
select
  c.relname as table_name,
  c.relrowsecurity as row_level_security_on,
  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'prediction_models') as policies,
  (select count(*) from public.prediction_models) as models_saved
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'prediction_models';
