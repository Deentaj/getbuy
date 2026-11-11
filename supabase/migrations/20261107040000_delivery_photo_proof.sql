begin;

alter table public.orders
  add column if not exists delivery_proof_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-proofs', 'delivery-proofs', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = 8388608,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Assigned riders can upload delivery proof" on storage.objects;
create policy "Assigned riders can upload delivery proof"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'delivery-proofs'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1
      from public.orders order_row
      join public.profiles rider on rider.id = auth.uid() and rider.role = 'delivery'
      where order_row.id::text = (storage.foldername(name))[1]
        and order_row.assigned_delivery_id = auth.uid()
        and order_row.status = 'out_for_delivery'
    )
  );

drop policy if exists "Order participants can view delivery proof" on storage.objects;
create policy "Order participants can view delivery proof"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'delivery-proofs'
    and exists (
      select 1 from public.orders order_row
      where order_row.id::text = (storage.foldername(name))[1]
        and (
          order_row.buyer_id = auth.uid()
          or order_row.assigned_delivery_id = auth.uid()
          or public.is_admin()
        )
    )
  );

create or replace function public.complete_delivery_with_proof(
  p_order_id uuid,
  p_delivery_proof_path text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  order_row public.orders%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'delivery'
  ) then
    raise exception 'A signed-in delivery partner is required.';
  end if;
  select * into order_row
  from public.orders
  where id = p_order_id
    and assigned_delivery_id = auth.uid()
    and status = 'out_for_delivery'
    and (payment_method <> 'monnify' or payment_status = 'paid')
    and delivery_proof_path is null
  for update;
  if not found then
    raise exception 'This assigned order is not awaiting delivery completion.';
  end if;
  if p_delivery_proof_path is null
    or (storage.foldername(p_delivery_proof_path))[1] <> p_order_id::text
    or (storage.foldername(p_delivery_proof_path))[2] <> auth.uid()::text
    or not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'delivery-proofs'
        and object.name = p_delivery_proof_path
    ) then
    raise exception 'Upload a valid delivery photo before completing this order.';
  end if;

  update public.orders
  set delivery_proof_path = p_delivery_proof_path,
      status = 'completed',
      updated_at = now()
  where id = p_order_id;
end;
$$;

revoke all on function public.complete_delivery_with_proof(uuid, text) from public, anon;
grant execute on function public.complete_delivery_with_proof(uuid, text) to authenticated;

commit;
