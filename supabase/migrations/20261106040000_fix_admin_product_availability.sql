create or replace function public.admin_set_product_availability(
  p_product_id uuid,
  p_is_available boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  affected_rows integer;
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
  end if;

  if p_is_available and not exists (
    select 1
    from public.products p
    where p.id = p_product_id
      and p.stock_quantity > 0
  ) then
    raise exception 'Products need available stock before they can be listed.';
  end if;

  update public.products
  set is_available = p_is_available,
      updated_at = now()
  where id = p_product_id;

  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    raise exception 'Product not found.';
  end if;
end;
$$;

revoke all on function public.admin_set_product_availability(uuid, boolean) from public, anon;
grant execute on function public.admin_set_product_availability(uuid, boolean) to authenticated;
