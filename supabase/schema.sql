create extension if not exists "pgcrypto";

create type public.user_role as enum ('buyer', 'seller', 'delivery', 'admin');
create type public.order_status as enum ('pending', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_path text,
  role public.user_role not null default 'buyer',
  phone_number text not null default '',
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  category text not null,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  description text,
  price numeric(10, 2) not null check (price >= 0),
  unit text not null default 'item',
  image_url text,
  category text not null default 'General',
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (buyer_id, product_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  assigned_delivery_id uuid references public.profiles(id) on delete set null,
  delivery_address text not null,
  payment_method text not null default 'cash_on_delivery',
  status public.order_status not null default 'pending',
  total numeric(10, 2) not null default 0 check (total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10, 2) not null check (unit_price >= 0)
);

create table public.delivery_partners (
  id uuid primary key references public.profiles(id) on delete cascade,
  vehicle_type text not null default '',
  is_available boolean not null default false,
  created_at timestamptz not null default now()
);

create index products_store_id_idx on public.products(store_id);
create index cart_items_buyer_id_idx on public.cart_items(buyer_id);
create index orders_buyer_id_idx on public.orders(buyer_id);
create index order_items_order_id_idx on public.order_items(order_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, phone_number)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'buyer'),
    coalesce(new.raw_user_meta_data ->> 'phone_number', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- These security-definer helpers avoid recursive policy evaluation across orders and order_items.
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

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.delivery_partners enable row level security;

create policy "Users can view their profile"
  on public.profiles for select using (auth.uid() = id);
create policy "Users can update their profile"
  on public.profiles for update using (auth.uid() = id);

create policy "Anyone can view stores"
  on public.stores for select using (true);
create policy "Sellers can manage their store"
  on public.stores for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "Anyone can view available products"
  on public.products for select using (is_available = true);
create policy "Sellers can manage store products"
  on public.products for all
  using (exists (
    select 1 from public.stores
    where stores.id = products.store_id and stores.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.stores
    where stores.id = products.store_id and stores.owner_id = auth.uid()
  ));

create policy "Buyers can manage their cart"
  on public.cart_items for all using (auth.uid() = buyer_id) with check (auth.uid() = buyer_id);

create policy "Buyers can view their orders"
  on public.orders for select using (auth.uid() = buyer_id);
create policy "Buyers can create their orders"
  on public.orders for insert with check (auth.uid() = buyer_id);

create policy "Buyers can view their order items"
  on public.order_items for select
  using (public.is_order_buyer(order_id));
create policy "Buyers can create their order items"
  on public.order_items for insert
  with check (public.is_order_buyer(order_id));

create policy "Delivery partners can view their profile"
  on public.delivery_partners for select using (auth.uid() = id);
create policy "Delivery partners can update their availability"
  on public.delivery_partners for update using (auth.uid() = id);
-- Sellers can update status of orders containing their products
create policy "Sellers can update their store orders"
  on public.orders for update
  using (public.is_seller_order(id))
  with check (public.is_seller_order(id));


-- Delivery partners can register their profile
create policy "Delivery partners can create their profile"
  on public.delivery_partners for insert with check (auth.uid() = id);

-- Sellers can view orders that contain their products
create policy "Sellers can view their store orders"
  on public.orders for select
  using (public.is_seller_order(id));

-- Delivery partners can view assigned or ready orders
create policy "Delivery partners can view assigned orders"
  on public.orders for select
  using (assigned_delivery_id = auth.uid() or status in ('ready', 'out_for_delivery'));

-- Delivery partners can update assigned order status
create policy "Delivery partners can update assigned orders"
  on public.orders for update
  using (assigned_delivery_id = auth.uid())
  with check (assigned_delivery_id = auth.uid());

-- Helper to check admin role without triggering RLS recursion
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Helper: is the current user the buyer of this order (bypasses RLS to avoid recursion)
-- Admins can view everything
create policy "Admins can view all profiles"
  on public.profiles for select
  using (public.is_admin());
create policy "Admins can view all stores"
  on public.stores for select
  using (public.is_admin());
create policy "Admins can view all products"
  on public.products for select
  using (public.is_admin());
create policy "Admins can view all orders"
  on public.orders for select
  using (public.is_admin());
create policy "Admins can view all order items"
  on public.order_items for select
  using (public.is_admin());

-- Storage bucket for product images
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "Anyone can view product images"
  on storage.objects for select
  using (bucket_id = 'product-images');
create policy "Sellers can upload product images"
  on storage.objects for insert
  with check (bucket_id = 'product-images' and auth.uid() is not null);
create policy "Sellers can update their product images"
  on storage.objects for update
  using (bucket_id = 'product-images' and auth.uid() is not null);
create policy "Sellers can delete their product images"
  on storage.objects for delete
  using (bucket_id = 'product-images' and auth.uid() is not null);

create index orders_assigned_delivery_id_idx on public.orders(assigned_delivery_id);
