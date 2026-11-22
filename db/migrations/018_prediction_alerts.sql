-- =============================================================================
-- 018 — Prediction alerts: which ones were sent
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm), after 017.
-- Safe to re-run. All or nothing: if any line fails, nothing is changed.
--
-- Every hour DMC's server checks the orders' estimates and tells staff, through
-- the bell in the top bar (server/alerts.js):
--   sales and management   an order may miss the customer's requested ship
--                          date, or has been in one step much longer than usual
--   procurement            a supplier's delivery is overdue
--
-- This table remembers which alerts were sent, so each one goes out once. Only
-- the server uses it: row level security is on with no policies, so no one
-- signed in can read or change it, and the server's service key goes around it.
-- =============================================================================

begin;


create table if not exists public.prediction_alerts (
  key                text primary key,
  customer_order_id  uuid references public.customer_orders (id) on delete cascade,
  purchase_order_id  uuid references public.purchase_orders (id) on delete cascade,
  sent_at            timestamptz not null default now()
);

create index if not exists prediction_alerts_customer_order_idx
  on public.prediction_alerts (customer_order_id);

create index if not exists prediction_alerts_purchase_order_idx
  on public.prediction_alerts (purchase_order_id);

-- Server only.
alter table public.prediction_alerts enable row level security;
revoke all on public.prediction_alerts from anon, authenticated;
grant all on public.prediction_alerts to service_role;


commit;


-- Check -----------------------------------------------------------------------
-- Expect one row: row level security on, 0 policies, 0 alerts sent yet.
select
  c.relname as table_name,
  c.relrowsecurity as row_level_security_on,
  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'prediction_alerts') as policies,
  (select count(*) from public.prediction_alerts) as alerts_sent
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'prediction_alerts';
