-- =============================================================================
-- Let the made-up demo customers sign in
--
-- The made-up customers of db/demo/simulated_history.sql (emails ending in
-- @simulated.example.com) are loaded with no password, so no one can sign in as
-- them. This gives all of them one password that YOU choose, so each account
-- can be signed in to and looked around: its dashboard, orders, payments,
-- documents and labels.
--
-- Before running: on the line marked below, replace TYPE-YOUR-PASSWORD-HERE
-- with the password you want (8 characters or more). The script stops, changing
-- nothing, if you haven't. The password is saved scrambled, like any account's;
-- it isn't written anywhere else. Don't save this file with your password in it.
--
-- Anyone who knows an account's email and this password can sign in as that
-- made-up customer, so pick one you don't use anywhere else.
--
-- It also gives each made-up order the payment due date it was loaded without
-- (histories loaded before Nov 17, 2026), which the Payments page needs.
--
-- Safe to run more than once: running it again just changes the password.
-- db/demo/remove_simulated_history.sql still takes the accounts out. After
-- loading the demo history again, run this again: the accounts come back with
-- no password.
--
-- To switch sign-in off again, run the three lines at the bottom of this file.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

do $$
declare
  -- ▼▼▼ TYPE YOUR PASSWORD BETWEEN THE QUOTES ▼▼▼
  v_password text := 'TYPE-YOUR-PASSWORD-HERE';
  -- ▲▲▲ ▲▲▲
  v_accounts integer;
begin
  if v_password = 'TYPE-YOUR-PASSWORD-HERE' or length(v_password) < 8 then
    raise exception 'Nothing was changed. Replace TYPE-YOUR-PASSWORD-HERE with your own password (8 characters or more), then run this again.';
  end if;

  -- A password, and the email marked as confirmed (an unconfirmed account
  -- can't sign in).
  update auth.users
  set encrypted_password = crypt(v_password, gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      updated_at = now()
  where email like '%@simulated.example.com';

  get diagnostics v_accounts = row_count;

  if v_accounts = 0 then
    raise exception 'No made-up customers found. Load db/demo/simulated_history.sql first.';
  end if;

  -- The sign-in method each account uses (email and password), as every
  -- account that signs up has.
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
  select gen_random_uuid(), u.id::text, u.id,
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
         'email', now(), now()
  from auth.users u
  where u.email like '%@simulated.example.com'
    and not exists (
      select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
    );

  -- A real order carries the day its quotation was valid to, and the payment
  -- screens add a week to it for the down payment's due date. A made-up order
  -- loaded without one gets 5 days after it was placed, so every down payment
  -- in the history (sent within 6 days) came in before it was due.
  update public.customer_orders
  set expiry_date = (created_at at time zone 'Asia/Manila')::date + 5
  where order_number like 'SIM-ORD-%'
    and expiry_date is null;
end $$;


-- The result: one row for each made-up customer, every true/false column true,
-- and 0 orders without a due date.
select p.company,
       u.email,
       coalesce(u.encrypted_password, '') <> '' as has_password,
       u.email_confirmed_at is not null as confirmed,
       exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email') as can_sign_in_by_email,
       (select count(*) from public.customer_orders o where o.customer_id = u.id and o.expiry_date is null) as orders_without_due_date
from auth.users u
join public.profiles p on p.id = u.id
where u.email like '%@simulated.example.com'
order by p.company;


-- -----------------------------------------------------------------------------
-- To switch sign-in off again (the accounts and their records stay), run:
--
--   update auth.users
--   set encrypted_password = ''
--   where email like '%@simulated.example.com';
-- -----------------------------------------------------------------------------
