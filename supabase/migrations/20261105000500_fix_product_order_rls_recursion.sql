create or replace function public.can_view_marketplace_order_item(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and (
        o.buyer_id = auth.uid()
        or exists (
          select 1
          from public.order_items oi
          join public.products p on p.id = oi.product_id
          join public.stores s on s.id = p.store_id
          where oi.order_id = o.id and s.owner_id = auth.uid()
        )
        or exists (
          select 1 from public.profiles
          where id = auth.uid() and role = 'admin'
        )
        or (
          exists (
            select 1 from public.profiles
            where id = auth.uid() and role = 'delivery'
          )
          and (
            o.assigned_delivery_id = auth.uid()
            or (o.status = 'ready' and o.assigned_delivery_id is null)
          )
        )
      )
  );
$$;

create or replace function public.can_view_purchased_product(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1
    from public.order_items oi
    where oi.product_id = p_product_id
      and public.can_view_marketplace_order_item(oi.order_id)
  );
$$;

revoke all on function public.can_view_marketplace_order_item(uuid) from public;
revoke all on function public.can_view_purchased_product(uuid) from public;
grant execute on function public.can_view_marketplace_order_item(uuid) to anon, authenticated;
grant execute on function public.can_view_purchased_product(uuid) to anon, authenticated;

drop policy if exists "Sellers can view order items for their products" on public.order_items;
drop policy if exists "Buyers can view their order items" on public.order_items;
drop policy if exists "Sellers and delivery partners can view relevant order items" on public.order_items;
drop policy if exists "Admins can view all order items" on public.order_items;
drop policy if exists "Order participants can view relevant order items" on public.order_items;
create policy "Order participants can view relevant order items"
  on public.order_items for select
  using (public.can_view_marketplace_order_item(order_id));

drop policy if exists "Order participants can view purchased products" on public.products;
create policy "Order participants can view purchased products"
  on public.products for select
  using (public.can_view_purchased_product(id));
