begin;

create table if not exists public.store_verifications (
  store_id uuid primary key references public.stores(id) on delete cascade,
  status text not null check (status in ('pending', 'verified', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null
);

alter table public.store_verifications enable row level security;
revoke all on public.store_verifications from anon, authenticated;
grant select (store_id, status) on public.store_verifications to anon, authenticated;

drop policy if exists "Public and owners can view store verification status" on public.store_verifications;
create policy "Public and owners can view store verification status"
  on public.store_verifications for select to anon, authenticated
  using (
    status = 'verified'
    or public.is_admin()
    or exists (
      select 1
      from public.stores s
      where s.id = store_verifications.store_id
        and s.owner_id = auth.uid()
    )
  );

create or replace view public.public_store_verification_status as
select store_id, status
from public.store_verifications;

alter view public.public_store_verification_status set (security_invoker = true);
grant select on public.public_store_verification_status to anon, authenticated;

create or replace function public.invalidate_store_verification_on_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.name is distinct from old.name
    or new.category is distinct from old.category
    or new.market_area is distinct from old.market_area
    or new.pickup_details is distinct from old.pickup_details
    or new.description is distinct from old.description
  then
    delete from public.store_verifications
    where store_id = old.id and status in ('pending', 'verified');
  end if;
  return new;
end;
$$;

drop trigger if exists invalidate_store_verification_after_store_change on public.stores;
create trigger invalidate_store_verification_after_store_change
after update of name, category, market_area, pickup_details, description on public.stores
for each row execute function public.invalidate_store_verification_on_profile_change();

create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() = old.id and new.role is distinct from old.role then
    raise exception 'You cannot change your own account role.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_self_profile_role_change on public.profiles;
create trigger prevent_self_profile_role_change
before update of role on public.profiles
for each row execute function public.prevent_self_role_change();

create or replace function public.request_store_verification(p_store_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  affected_rows integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in before requesting store verification.';
  end if;

  if not exists (
    select 1
    from public.stores s
    where s.id = p_store_id
      and s.owner_id = auth.uid()
      and nullif(trim(s.name), '') is not null
      and nullif(trim(s.category), '') is not null
      and nullif(trim(s.market_area), '') is not null
      and nullif(trim(s.pickup_details), '') is not null
  ) then
    raise exception 'Complete your store name, category, market area, and pickup details before requesting verification.';
  end if;

  insert into public.store_verifications (store_id, status, requested_at, reviewed_at, reviewed_by)
  values (p_store_id, 'pending', now(), null, null)
  on conflict (store_id) do update
    set status = 'pending',
        requested_at = now(),
        reviewed_at = null,
        reviewed_by = null
    where public.store_verifications.status = 'rejected';

  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    raise exception 'This store is already verified or has a request awaiting review.';
  end if;

  return 'pending';
end;
$$;

drop function if exists public.get_store_verification_queue();
create function public.get_store_verification_queue()
returns table (
  store_id uuid,
  store_name text,
  category text,
  market_area text,
  pickup_details text,
  description text,
  owner_name text,
  owner_email text,
  requested_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
set row_security = off
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Only administrators can review store verification requests.';
  end if;

  return query
  select s.id, s.name, s.category, s.market_area, s.pickup_details, s.description,
         p.full_name, coalesce(u.email, '')::text, v.requested_at
  from public.store_verifications v
  join public.stores s on s.id = v.store_id
  join public.profiles p on p.id = s.owner_id
  join auth.users u on u.id = s.owner_id
  where v.status = 'pending'
  order by v.requested_at asc;
end;
$$;

create or replace function public.review_store_verification(p_store_id uuid, p_approved boolean)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  next_status text;
  affected_rows integer;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Only administrators can review store verification requests.';
  end if;

  next_status := case when p_approved then 'verified' else 'rejected' end;
  update public.store_verifications
  set status = next_status,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where store_id = p_store_id and status = 'pending';

  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    raise exception 'This verification request is no longer pending.';
  end if;

  return next_status;
end;
$$;

create or replace function public.get_admin_dashboard_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  snapshot jsonb;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
  end if;

  select jsonb_build_object(
    'metrics', jsonb_build_object(
      'buyers', (select count(*) from public.profiles where role = 'buyer'),
      'stores', (select count(*) from public.stores),
      'pending_verification', (select count(*) from public.store_verifications where status = 'pending'),
      'live_orders', (select count(*) from public.orders where status in ('pending', 'accepted', 'preparing', 'ready', 'out_for_delivery')),
      'available_riders', (select count(*) from public.delivery_partners where is_available)
    ),
    'orders', coalesce((
      select jsonb_agg(to_jsonb(recent_orders) order by recent_orders.created_at desc)
      from (
        select o.id, o.status, o.total, o.payment_method, o.delivery_address, o.created_at,
               o.assigned_delivery_id,
               coalesce(buyer.full_name, 'Buyer') as buyer_name,
               coalesce(rider.full_name, 'Unassigned') as rider_name,
               count(oi.id)::integer as item_count
        from public.orders o
        left join public.profiles buyer on buyer.id = o.buyer_id
        left join public.profiles rider on rider.id = o.assigned_delivery_id
        left join public.order_items oi on oi.order_id = o.id
        group by o.id, buyer.full_name, rider.full_name
        order by o.created_at desc
        limit 100
      ) recent_orders
    ), '[]'::jsonb),
    'stores', coalesce((
      select jsonb_agg(to_jsonb(recent_stores) order by recent_stores.created_at desc)
      from (
        select s.id, s.name, s.category, s.market_area, s.owner_id, s.created_at,
               coalesce(owner.full_name, 'Store owner') as owner_name,
               count(p.id)::integer as product_count,
               coalesce(v.status, 'unverified') as verification_status
        from public.stores s
        left join public.profiles owner on owner.id = s.owner_id
        left join public.products p on p.store_id = s.id
        left join public.store_verifications v on v.store_id = s.id
        group by s.id, owner.full_name, v.status
        order by s.created_at desc
        limit 100
      ) recent_stores
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(to_jsonb(recent_products) order by recent_products.created_at desc)
      from (
        select p.id, p.name, p.category, p.price, p.unit, p.stock_quantity,
               p.is_available, p.created_at, s.name as store_name, s.id as store_id
        from public.products p
        join public.stores s on s.id = p.store_id
        order by p.created_at desc
        limit 100
      ) recent_products
    ), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(to_jsonb(recent_users) order by recent_users.created_at desc)
      from (
        select id, full_name, role, area, created_at
        from public.profiles
        order by created_at desc
        limit 100
      ) recent_users
    ), '[]'::jsonb),
    'delivery_partners', coalesce((
      select jsonb_agg(to_jsonb(recent_riders) order by recent_riders.created_at desc)
      from (
        select dp.id, coalesce(profile.full_name, 'Delivery partner') as full_name,
               dp.vehicle_type, dp.is_available, dp.created_at
        from public.delivery_partners dp
        left join public.profiles profile on profile.id = dp.id
        order by dp.created_at desc
        limit 100
      ) recent_riders
    ), '[]'::jsonb)
  ) into snapshot;

  return snapshot;
end;
$$;

create or replace function public.admin_set_product_availability(p_product_id uuid, p_is_available boolean)
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
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
  end if;

  if p_is_available and not exists (
    select 1 from public.products p
    where p.id = p_product_id and p.stock_quantity > 0
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

revoke all on function public.request_store_verification(uuid) from public, anon;
revoke all on function public.get_store_verification_queue() from public, anon;
revoke all on function public.review_store_verification(uuid, boolean) from public, anon;
revoke all on function public.get_admin_dashboard_snapshot() from public, anon;
revoke all on function public.admin_set_product_availability(uuid, boolean) from public, anon;
grant execute on function public.request_store_verification(uuid) to authenticated;
grant execute on function public.get_store_verification_queue() to authenticated;
grant execute on function public.review_store_verification(uuid, boolean) to authenticated;
grant execute on function public.get_admin_dashboard_snapshot() to authenticated;
grant execute on function public.admin_set_product_availability(uuid, boolean) to authenticated;

commit;
