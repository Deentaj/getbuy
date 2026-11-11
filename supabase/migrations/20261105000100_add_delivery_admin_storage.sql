-- Helper to check admin role without triggering RLS recursion
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Migration: add delivery assignment, seller/admin/delivery RLS policies, and product image storage
-- Safe to run multiple times (idempotent).

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'assigned_delivery_id'
  ) then
    alter table public.orders add column assigned_delivery_id uuid references public.profiles(id) on delete set null;
  end if;
end
$$;

do $$
begin
  drop policy if exists "Admins can view all profiles" on public.profiles;
  drop policy if exists "Admins can view all stores" on public.stores;
  drop policy if exists "Admins can view all products" on public.products;
  drop policy if exists "Admins can view all orders" on public.orders;
  drop policy if exists "Admins can view all order items" on public.order_items;
end
$$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='delivery_partners' and policyname='Delivery partners can create their profile') then
    create policy "Delivery partners can create their profile"
      on public.delivery_partners for insert with check (auth.uid() = id);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='orders' and policyname='Sellers can view their store orders') then
    create policy "Sellers can view their store orders"
      on public.orders for select
      using (exists (
        select 1 from public.order_items oi
        join public.products p on p.id = oi.product_id
        join public.stores s on s.id = p.store_id
        where oi.order_id = orders.id and s.owner_id = auth.uid()
      ));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='orders' and policyname='Sellers can update their store orders') then
    create policy "Sellers can update their store orders"
      on public.orders for update
      using (exists (
        select 1 from public.order_items oi
        join public.products p on p.id = oi.product_id
        join public.stores s on s.id = p.store_id
        where oi.order_id = orders.id and s.owner_id = auth.uid()
      ))
      with check (exists (
        select 1 from public.order_items oi
        join public.products p on p.id = oi.product_id
        join public.stores s on s.id = p.store_id
        where oi.order_id = orders.id and s.owner_id = auth.uid()
      ));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='orders' and policyname='Delivery partners can view assigned orders') then
    create policy "Delivery partners can view assigned orders"
      on public.orders for select
      using (assigned_delivery_id = auth.uid() or status in ('ready', 'out_for_delivery'));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='orders' and policyname='Delivery partners can update assigned orders') then
    create policy "Delivery partners can update assigned orders"
      on public.orders for update
      using (assigned_delivery_id = auth.uid())
      with check (assigned_delivery_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='Admins can view all profiles') then
    create policy "Admins can view all profiles"
      on public.profiles for select
      using (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='stores' and policyname='Admins can view all stores') then
    create policy "Admins can view all stores"
      on public.stores for select
      using (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='products' and policyname='Admins can view all products') then
    create policy "Admins can view all products"
      on public.products for select
      using (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='orders' and policyname='Admins can view all orders') then
    create policy "Admins can view all orders"
      on public.orders for select
      using (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='order_items' and policyname='Admins can view all order items') then
    create policy "Admins can view all order items"
      on public.order_items for select
      using (public.is_admin());
  end if;
end
$$;


-- Storage bucket for product images (idempotent)
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Anyone can view product images') then
    create policy "Anyone can view product images"
      on storage.objects for select
      using (bucket_id = 'product-images');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Sellers can upload product images') then
    create policy "Sellers can upload product images"
      on storage.objects for insert
      with check (bucket_id = 'product-images' and auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Sellers can update their product images') then
    create policy "Sellers can update their product images"
      on storage.objects for update
      using (bucket_id = 'product-images' and auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Sellers can delete their product images') then
    create policy "Sellers can delete their product images"
      on storage.objects for delete
      using (bucket_id = 'product-images' and auth.uid() is not null);
  end if;
end
$$;

create index if not exists orders_assigned_delivery_id_idx on public.orders(assigned_delivery_id);
