create or replace function public.get_seller_dashboard_orders()
returns table (
  order_id uuid,
  status public.order_status,
  delivery_address text,
  total numeric,
  assigned_delivery_id uuid,
  items_summary text
)
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'seller'
  ) then
    raise exception 'A seller account is required.';
  end if;

  return query
  select
    o.id,
    o.status,
    o.delivery_address,
    sum(oi.quantity * oi.unit_price),
    o.assigned_delivery_id,
    string_agg(
      format('%s × %s %s', oi.quantity, p.name, p.unit),
      E'\n' order by p.name
    )
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  join public.products p on p.id = oi.product_id
  join public.stores s on s.id = p.store_id
  where s.owner_id = auth.uid()
    and o.status in ('pending', 'accepted', 'preparing', 'ready')
  group by o.id
  order by o.created_at desc
  limit 10;
end;
$$;

revoke all on function public.get_seller_dashboard_orders() from public;
grant execute on function public.get_seller_dashboard_orders() to authenticated;
