-- =============================================================================
-- 014 — Who can open and upload files
-- =============================================================================
-- Run in the Supabase SQL editor (project scotywfepxfispgpauwm). Safe to re-run.
-- All or nothing: if any line fails, nothing is changed. Run 013 first.
--
-- The same idea as 013, for uploaded files. A customer can open only the documents
-- and labels of their own orders and quotations, and their own proofs of payment.
-- Staff can open what their pages need. Product images stay public, since the
-- catalog shows them.
-- =============================================================================

begin;


-- Remove the old rules --------------------------------------------------------
do $$
declare
  v_policy record;
begin
  for v_policy in
    select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
  loop
    execute format('drop policy %I on storage.objects', v_policy.policyname);
  end loop;
end;
$$;


-- Which files belong to a customer --------------------------------------------
-- Decided by what their own records point at, not by the file's name.
create or replace function public.customer_can_open_document(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from customer_orders o
    where o.customer_id = auth.uid()
      and p_path in (o.pfi_file_path, o.pack_list_path, o.cert_shipment_path, o.cert_clearance_path)
  )
  or exists (
    select 1
    from quotations q
    join quotation_requests r on r.id = q.quotation_request_id
    where r.customer_id = auth.uid() and q.pfi_file_path = p_path
  )
$$;

revoke execute on function public.customer_can_open_document(text) from public, anon;
grant execute on function public.customer_can_open_document(text) to authenticated;

create or replace function public.customer_can_open_label(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from compliance_label_exchanges e
    join customer_order_items i on i.id = e.customer_order_item_id
    join customer_orders o on o.id = i.customer_order_id
    where o.customer_id = auth.uid()
      and p_path in (e.original_label_path, e.customer_design_path)
  )
$$;

revoke execute on function public.customer_can_open_label(text) from public, anon;
grant execute on function public.customer_can_open_label(text) to authenticated;


-- Product images: public to view, admin to change -----------------------------
create policy "product images: read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'product-images');

create policy "product images: admin adds" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and (select public.has_role('admin')));

create policy "product images: admin changes" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and (select public.has_role('admin')))
  with check (bucket_id = 'product-images' and (select public.has_role('admin')));

create policy "product images: admin removes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and (select public.has_role('admin')));


-- Documents: PFIs, supplier PFIs, packing lists, certificates ------------------
create policy "documents: staff read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (select public.has_role('admin', 'sales', 'procurement', 'warehouse', 'management'))
  );

create policy "documents: customer reads own" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and public.customer_can_open_document(name));

create policy "documents: staff add" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (select public.has_role('admin', 'sales', 'procurement', 'warehouse'))
  );

-- Generating a document again replaces the file.
create policy "documents: staff replace" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documents'
    and (select public.has_role('admin', 'sales', 'procurement', 'warehouse'))
  )
  with check (
    bucket_id = 'documents'
    and (select public.has_role('admin', 'sales', 'procurement', 'warehouse'))
  );


-- Proofs of payment ------------------------------------------------------------
create policy "payment proofs: staff read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (select public.has_role('admin', 'sales', 'procurement'))
  );

create policy "payment proofs: customer reads own" on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-proofs' and owner_id = auth.uid()::text);

create policy "payment proofs: add" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (select public.has_role('admin', 'sales', 'procurement', 'customer'))
  );

-- Only to undo an upload whose payment failed to save.
create policy "payment proofs: remove own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'payment-proofs' and owner_id = auth.uid()::text);


-- Compliance labels ------------------------------------------------------------
create policy "labels: staff read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'compliance-labels'
    and (select public.has_role('admin', 'sales', 'procurement', 'warehouse', 'management'))
  );

create policy "labels: customer reads own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'compliance-labels'
    and (owner_id = auth.uid()::text or public.customer_can_open_label(name))
  );

create policy "labels: add" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'compliance-labels'
    and (select public.has_role('admin', 'sales', 'warehouse', 'customer'))
  );

commit;


-- Check -----------------------------------------------------------------------
-- Expect the file rules above, with nothing left from before.
select policyname, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;
