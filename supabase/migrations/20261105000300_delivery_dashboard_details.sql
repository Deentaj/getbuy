create or replace function public.get_delivery_dashboard()
returns table (
  id uuid,
  status public.order_status,
  delivery_address text,
  total numeric,
  assigned_delivery_id uuid,
  buyer_name text,
  buyer_directions text,
  pickup_details text,
  items_summary text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'delivery'
  ) then
    raise exception 'A delivery partner account is required.';
  end if;

  return query
  select
    o.id,
    o.status,
    o.delivery_address,
    o.total,
    o.assigned_delivery_id,
    coalesce(buyer.full_name, ''),
    coalesce(buyer.directions, ''),
    coalesce(
      string_agg(
        distinct nullif(concat_ws(' · ', nullif(s.name, ''), nullif(s.market_area, ''), nullif(s.pickup_details, '')), ''),
        ' | '
      ),
      'Pickup details unavailable'
    ),
    coalesce(
      string_agg(
        format('%s %s %s', oi.quantity, p.unit, p.name),
        ' + ' order by p.name
      ),
      'Order items unavailable'
    ),
    o.updated_at
  from public.orders o
  left join public.profiles buyer on buyer.id = o.buyer_id
  left join public.order_items oi on oi.order_id = o.id
  left join public.products p on p.id = oi.product_id
  left join public.stores s on s.id = p.store_id
  where (
    o.assigned_delivery_id = auth.uid()
    and (
      o.status in ('ready', 'out_for_delivery')
      or (o.status = 'completed' and o.updated_at >= date_trunc('day', now()))
    )
  ) or (
    o.status = 'ready'
    and o.assigned_delivery_id is null
  )
  group by o.id, buyer.full_name, buyer.directions
  order by o.updated_at desc;
end;
$$;

revoke all on function public.get_delivery_dashboard() from public;
grant execute on function public.get_delivery_dashboard() to authenticated;
