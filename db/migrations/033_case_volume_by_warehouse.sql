-- =============================================================================
-- 033: Warehouse staff can correct a product's volume per case
--
-- The volume of one case (m³) is what the system plans containers with (and
-- will plan pallet space with). Admin edits it with the rest of the product;
-- warehouse staff, who handle the cases, can now correct it too, through one
-- step that changes that value and nothing else (they can't change prices,
-- names or anything else about a product).
--
-- Every change of a case's volume, by anyone, is recorded with who and when,
-- and the Products page shows the latest. Changing it doesn't change any
-- quotation already made: only the next ones plan with it.
--
-- Safe to run more than once. No policies are dropped.
-- =============================================================================

-- Who changed a case's volume, from what to what, and when ----------------------
create table if not exists public.product_case_volume_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  old_cbm numeric,
  new_cbm numeric,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  changed_by_name text,
  changed_by_role text
);

alter table public.product_case_volume_history enable row level security;

drop policy if exists "staff: read case volume history" on public.product_case_volume_history;
create policy "staff: read case volume history" on public.product_case_volume_history
  for select to authenticated
  using ((select public.has_role('admin', 'warehouse', 'sales', 'procurement', 'management')));

create or replace function public.log_case_volume_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_role text;
begin
  if new.cbm is distinct from old.cbm then
    select name, lower(trim(role)) into v_name, v_role from profiles where id = auth.uid();

    insert into product_case_volume_history (product_id, old_cbm, new_cbm, changed_by, changed_by_name, changed_by_role)
    values (new.id, old.cbm, new.cbm, auth.uid(), v_name, v_role);
  end if;

  return null;
end;
$$;

revoke execute on function public.log_case_volume_change() from public, anon, authenticated;

drop trigger if exists products_case_volume_history on public.products;
create trigger products_case_volume_history
  after update of cbm on public.products
  for each row execute function public.log_case_volume_change();


-- The one step warehouse staff (and admin) use ---------------------------------------
create or replace function public.set_case_volume(p_product_id uuid, p_cbm numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product record;
begin
  if not public.has_role('admin', 'warehouse') then
    raise exception 'Only warehouse staff or admin can change the volume of a case.';
  end if;

  if p_cbm is null or p_cbm <= 0 or p_cbm > 2 then
    raise exception 'Enter the volume of one case in m³: more than 0 and at most 2 (for example 0.0242).';
  end if;

  select id, product_name, cbm, gross_weight_kg into v_product
  from products where id = p_product_id
  for update;

  if not found then
    raise exception 'Product not found.';
  end if;

  if coalesce(v_product.gross_weight_kg, 0) <= 0 then
    raise exception '% has no weight per case yet. Admin must add it in the product first.', v_product.product_name;
  end if;

  update products set cbm = p_cbm where id = p_product_id;

  return jsonb_build_object('product_id', p_product_id, 'old_cbm', v_product.cbm, 'cbm', p_cbm);
end;
$$;

revoke execute on function public.set_case_volume(uuid, numeric) from public, anon;
grant execute on function public.set_case_volume(uuid, numeric) to authenticated;


-- Check: the step and the record are in place (expect true, true), and how many
-- products have a volume per case.
select
  to_regprocedure('public.set_case_volume(uuid, numeric)') is not null as warehouse_can_set_case_volume,
  exists (
    select 1 from pg_trigger
    where tgname = 'products_case_volume_history' and tgrelid = 'public.products'::regclass
  ) as changes_recorded,
  (select count(*) from public.products where coalesce(cbm, 0) > 0) as products_with_case_volume,
  (select count(*) from public.products) as products;
