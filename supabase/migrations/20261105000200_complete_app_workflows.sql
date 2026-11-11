create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested_role text := new.raw_user_meta_data ->> 'role';
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case
      when requested_role in ('buyer', 'seller', 'delivery') then requested_role::public.user_role
      else 'buyer'::public.user_role
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

alter table public.products
  add column if not exists stock_quantity numeric(10, 2) not null default 0
  check (stock_quantity >= 0);

alter table public.stores
  add column if not exists market_area text not null default '',
  add column if not exists pickup_details text not null default '',
  add column if not exists description text not null default '';

alter table public.profiles
  add column if not exists area text not null default '',
  add column if not exists directions text not null default '';

create or replace function public.create_marketplace_order(
  p_delivery_address text,
  p_payment_method text,
  p_product_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  new_order_id uuid;
  available_count integer;
  order_total numeric(10, 2);
begin
  if auth.uid() is null then
    raise exception 'Sign in before placing an order.';
  end if;
  if nullif(trim(p_delivery_address), '') is null then
    raise exception 'A delivery address is required.';
  end if;
  if p_payment_method is distinct from 'cash_on_delivery' then
    raise exception 'This payment method is not supported.';
  end if;
  if p_product_ids is null or cardinality(p_product_ids) = 0 then
    raise exception 'Add at least one product before placing an order.';
  end if;

  perform p.id
  from public.products p
  join (
    select distinct requested_product.product_id
    from unnest(p_product_ids) as requested_product(product_id)
  ) requested on requested.product_id = p.id
  order by p.id
  for update of p;

  select count(*) into available_count
  from (
    select requested_product.product_id, count(*) as quantity
    from unnest(p_product_ids) as requested_product(product_id)
    group by requested_product.product_id
  ) requested
  join public.products p on p.id = requested.product_id
  where p.is_available = true
    and p.stock_quantity >= requested.quantity;
  if available_count <> (
    select count(*) from (
      select distinct requested_product.product_id
      from unnest(p_product_ids) as requested_product(product_id)
    ) requested
  ) then
    raise exception 'One or more products are unavailable or have insufficient stock.';
  end if;

  select coalesce(sum(p.price), 0) into order_total
  from unnest(p_product_ids) as requested(product_id)
  join public.products p on p.id = requested.product_id;

  insert into public.orders (buyer_id, delivery_address, payment_method, total)
  values (auth.uid(), trim(p_delivery_address), p_payment_method, order_total)
  returning id into new_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price)
  select new_order_id, p.id, count(*), p.price
  from unnest(p_product_ids) as requested(product_id)
  join public.products p on p.id = requested.product_id
  group by p.id, p.price;

  update public.products p
  set stock_quantity = p.stock_quantity - requested.quantity,
      is_available = p.is_available and p.stock_quantity - requested.quantity > 0,
      updated_at = now()
  from (
    select requested_product.product_id, count(*) as quantity
    from unnest(p_product_ids) as requested_product(product_id)
    group by requested_product.product_id
  ) requested
  where p.id = requested.product_id;

  return new_order_id;
end;
$$;

revoke all on function public.create_marketplace_order(text, text, uuid[]) from public;
grant execute on function public.create_marketplace_order(text, text, uuid[]) to authenticated;

create or replace function public.claim_delivery_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  claimed_order_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'delivery'
  ) then
    raise exception 'A delivery partner account is required.';
  end if;

  update public.orders
  set assigned_delivery_id = auth.uid(), updated_at = now()
  where id = p_order_id
    and status = 'ready'
    and assigned_delivery_id is null
  returning id into claimed_order_id;

  return claimed_order_id is not null;
end;
$$;

revoke all on function public.claim_delivery_order(uuid) from public;
grant execute on function public.claim_delivery_order(uuid) to authenticated;

create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
    and new.role is distinct from old.role
    and not public.is_admin() then
    raise exception 'Only an administrator can change account roles.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_self_role_change on public.profiles;
create trigger prevent_self_role_change
  before update on public.profiles
  for each row execute procedure public.prevent_self_role_change();

drop policy if exists "Buyers can create their orders" on public.orders;
drop policy if exists "Buyers can create their order items" on public.order_items;

drop policy if exists "Sellers can update their store orders" on public.orders;
create policy "Sellers can update their store orders"
  on public.orders for update
  using (
    public.is_seller_order(id)
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'seller')
  )
  with check (
    public.is_seller_order(id)
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'seller')
  );

drop policy if exists "Delivery partners can view assigned orders" on public.orders;
create policy "Delivery partners can view assigned orders"
  on public.orders for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'delivery')
    and (
      assigned_delivery_id = auth.uid()
      or (status = 'ready' and assigned_delivery_id is null)
    )
  );

drop policy if exists "Delivery partners can update assigned orders" on public.orders;
create policy "Delivery partners can update assigned orders"
  on public.orders for update
  using (
    assigned_delivery_id = auth.uid()
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'delivery')
  )
  with check (
    assigned_delivery_id = auth.uid()
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'delivery')
  );

revoke update on public.orders from authenticated;
grant update (status, updated_at) on public.orders to authenticated;

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

drop policy if exists "Order participants can view relevant order items" on public.order_items;
drop policy if exists "Sellers can view order items for their products" on public.order_items;
drop policy if exists "Buyers can view their order items" on public.order_items;
drop policy if exists "Sellers and delivery partners can view relevant order items" on public.order_items;
drop policy if exists "Admins can view all order items" on public.order_items;
create policy "Order participants can view relevant order items"
  on public.order_items for select
  using (public.can_view_marketplace_order_item(order_id));

drop policy if exists "Order participants can view purchased products" on public.products;
create policy "Order participants can view purchased products"
  on public.products for select
  using (public.can_view_purchased_product(id));
