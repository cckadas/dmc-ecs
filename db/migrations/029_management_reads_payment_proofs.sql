-- =============================================================================
-- 029: Management can open payment proofs (to look at, not to change)
--
-- Management now sees Customer Orders, view only: the orders, their payments and
-- each payment's history, but no approving or rejecting (only sales and admin
-- check payments; review_order_payment in 027 refuses anyone else). Opening a
-- payment's proof needs this: until now only admin, sales and procurement could
-- read the payment-proofs files (014).
--
-- Adds one read policy; changes nothing else. Safe to run more than once.
-- =============================================================================

drop policy if exists "payment proofs: management reads" on storage.objects;

create policy "payment proofs: management reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-proofs' and (select public.has_role('management')));


-- Check: the new rule is there (expect true).
select exists (
  select 1 from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname = 'payment proofs: management reads'
) as management_reads_payment_proofs;
