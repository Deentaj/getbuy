create or replace function public.is_order_buyer(p_order_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (select 1 from public.orders where id = p_order_id and buyer_id = auth.uid());
$$;

create or replace function public.is_seller_order(p_order_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1 from public.order_items oi
    join public.products p on p.id = oi.product_id
    join public.stores s on s.id = p.store_id
    where oi.order_id = p_order_id and s.owner_id = auth.uid()
  );
$$;

drop policy if exists "Sellers can view their store orders" on public.orders;
drop policy if exists "Sellers can update their store orders" on public.orders;
drop policy if exists "Sellers can view orders containing their products" on public.orders;

create policy "Sellers can view their store orders"
  on public.orders for select
  using (public.is_seller_order(id));

create policy "Sellers can update their store orders"
  on public.orders for update
  using (public.is_seller_order(id))
  with check (public.is_seller_order(id));