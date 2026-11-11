begin;

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

alter table public.store_verifications
  add column if not exists storefront_photo_path text,
  add column if not exists seller_id_path text;

create table if not exists public.rider_verifications (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null unique references public.delivery_partners(id) on delete cascade,
  plate_number text not null,
  plate_photo_path text not null,
  roadworthiness_photo_path text not null,
  driver_license_photo_path text not null,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null
);

alter table public.rider_verifications enable row level security;
revoke all on public.rider_verifications from anon, authenticated;

update public.delivery_partners dp
set is_available = false
where dp.is_available
  and not exists (
    select 1 from public.rider_verifications v
    where v.rider_id = dp.id and v.status = 'verified'
  );

create or replace function public.require_verified_rider_for_availability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.is_available and not exists (
    select 1 from public.rider_verifications v
    where v.rider_id = new.id and v.status = 'verified'
  ) then
    raise exception 'Rider verification must be approved before going online.';
  end if;
  return new;
end;
$$;

drop trigger if exists require_verified_rider_for_availability on public.delivery_partners;
create trigger require_verified_rider_for_availability
before insert or update of is_available on public.delivery_partners
for each row execute function public.require_verified_rider_for_availability();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verification-documents', 'verification-documents', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Verification applicants can upload their documents" on storage.objects;
create policy "Verification applicants can upload their documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Applicants and admins can view verification documents" on storage.objects;
create policy "Applicants and admins can view verification documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'verification-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

drop policy if exists "Applicants can remove their verification documents" on storage.objects;
create policy "Applicants can remove their verification documents"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop function if exists public.request_store_verification(uuid, text, text);
drop function if exists public.request_store_verification(uuid);
create function public.request_store_verification(
  p_store_id uuid,
  p_storefront_photo_path text,
  p_seller_id_path text
)
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
  if coalesce(p_storefront_photo_path, '') not like (auth.uid()::text || '/%')
    or coalesce(p_seller_id_path, '') not like (auth.uid()::text || '/%')
    or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'verification-documents' and o.name = p_storefront_photo_path
    )
    or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'verification-documents' and o.name = p_seller_id_path
    ) then
    raise exception 'Upload both verification photos before submitting.';
  end if;
  if not exists (
    select 1 from public.stores s
    join public.profiles owner on owner.id = s.owner_id and owner.role = 'seller'
    where s.id = p_store_id
      and s.owner_id = auth.uid()
      and nullif(trim(s.name), '') is not null
      and nullif(trim(s.category), '') is not null
      and nullif(trim(s.market_area), '') is not null
      and nullif(trim(s.pickup_details), '') is not null
  ) then
    raise exception 'Complete your store name, category, market area, and pickup details before requesting verification.';
  end if;

  insert into public.store_verifications (
    store_id, status, requested_at, reviewed_at, reviewed_by,
    storefront_photo_path, seller_id_path
  )
  values (
    p_store_id, 'pending', now(), null, null,
    p_storefront_photo_path, p_seller_id_path
  )
  on conflict (store_id) do update
    set status = 'pending',
        requested_at = now(),
        reviewed_at = null,
        reviewed_by = null,
        storefront_photo_path = excluded.storefront_photo_path,
        seller_id_path = excluded.seller_id_path
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
  requested_at timestamptz,
  storefront_photo_path text,
  seller_id_path text
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
         p.full_name, coalesce(u.email, '')::text, v.requested_at,
         v.storefront_photo_path, v.seller_id_path
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
  if p_approved and not exists (
    select 1
    from public.store_verifications v
    join storage.objects storefront
      on storefront.bucket_id = 'verification-documents'
      and storefront.name = v.storefront_photo_path
    join storage.objects seller_id
      on seller_id.bucket_id = 'verification-documents'
      and seller_id.name = v.seller_id_path
    where v.store_id = p_store_id and v.status = 'pending'
  ) then
    raise exception 'Both required store verification photos must be available before approval.';
  end if;
  next_status := case when p_approved then 'verified' else 'rejected' end;
  update public.store_verifications
  set status = next_status, reviewed_at = now(), reviewed_by = auth.uid()
  where store_id = p_store_id and status = 'pending';
  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    raise exception 'This store verification request is no longer pending.';
  end if;
  return next_status;
end;
$$;

create or replace function public.request_rider_verification(
  p_plate_number text,
  p_plate_photo_path text,
  p_roadworthiness_photo_path text,
  p_driver_license_photo_path text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  affected_rows integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'delivery'
  ) then
    raise exception 'A signed-in delivery partner account is required.';
  end if;
  if nullif(trim(p_plate_number), '') is null or length(trim(p_plate_number)) > 20 then
    raise exception 'Enter a valid vehicle plate number.';
  end if;
  if coalesce(p_plate_photo_path, '') not like (auth.uid()::text || '/%')
    or coalesce(p_roadworthiness_photo_path, '') not like (auth.uid()::text || '/%')
    or coalesce(p_driver_license_photo_path, '') not like (auth.uid()::text || '/%')
    or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'verification-documents' and o.name = p_plate_photo_path
    )
    or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'verification-documents' and o.name = p_roadworthiness_photo_path
    )
    or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'verification-documents' and o.name = p_driver_license_photo_path
    ) then
    raise exception 'Upload the number plate, roadworthiness, and driver licence photos before submitting.';
  end if;
  if not exists (select 1 from public.delivery_partners d where d.id = auth.uid()) then
    raise exception 'Save your delivery profile before requesting verification.';
  end if;

  insert into public.rider_verifications (
    rider_id, plate_number, plate_photo_path, roadworthiness_photo_path,
    driver_license_photo_path, status, requested_at, reviewed_at, reviewed_by
  )
  values (
    auth.uid(), trim(p_plate_number), p_plate_photo_path, p_roadworthiness_photo_path,
    p_driver_license_photo_path, 'pending', now(), null, null
  )
  on conflict (rider_id) do update
    set plate_number = excluded.plate_number,
        plate_photo_path = excluded.plate_photo_path,
        roadworthiness_photo_path = excluded.roadworthiness_photo_path,
        driver_license_photo_path = excluded.driver_license_photo_path,
        status = 'pending',
        requested_at = now(),
        reviewed_at = null,
        reviewed_by = null
    where public.rider_verifications.status = 'rejected';

  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    raise exception 'Your rider verification is already approved or awaiting review.';
  end if;
  return 'pending';
end;
$$;

create or replace function public.get_rider_verification_queue()
returns table (
  verification_id uuid,
  rider_id uuid,
  rider_name text,
  rider_email text,
  plate_number text,
  plate_photo_path text,
  roadworthiness_photo_path text,
  driver_license_photo_path text,
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
    raise exception 'Only administrators can review rider verification requests.';
  end if;
  return query
  select v.id, v.rider_id, p.full_name, coalesce(u.email, '')::text,
         v.plate_number, v.plate_photo_path, v.roadworthiness_photo_path,
         v.driver_license_photo_path, v.requested_at
  from public.rider_verifications v
  join public.profiles p on p.id = v.rider_id
  join auth.users u on u.id = v.rider_id
  where v.status = 'pending'
  order by v.requested_at asc;
end;
$$;

create or replace function public.review_rider_verification(p_verification_id uuid, p_approved boolean)
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
    raise exception 'Only administrators can review rider verification requests.';
  end if;
  if p_approved and not exists (
    select 1
    from public.rider_verifications v
    join storage.objects plate
      on plate.bucket_id = 'verification-documents' and plate.name = v.plate_photo_path
    join storage.objects roadworthiness
      on roadworthiness.bucket_id = 'verification-documents' and roadworthiness.name = v.roadworthiness_photo_path
    join storage.objects driver_license
      on driver_license.bucket_id = 'verification-documents' and driver_license.name = v.driver_license_photo_path
    where v.id = p_verification_id and v.status = 'pending'
  ) then
    raise exception 'All required rider verification photos must be available before approval.';
  end if;
  next_status := case when p_approved then 'verified' else 'rejected' end;
  update public.rider_verifications
  set status = next_status, reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_verification_id and status = 'pending';
  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    raise exception 'This rider verification request is no longer pending.';
  end if;
  if not p_approved then
    update public.delivery_partners
    set is_available = false
    where id = (select rider_id from public.rider_verifications where id = p_verification_id);
  end if;
  return next_status;
end;
$$;

create or replace function public.get_rider_verification_status()
returns table (status text, plate_number text)
language sql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select v.status, v.plate_number
  from public.rider_verifications v
  where v.rider_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'delivery'
    );
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
      'pending_rider_verification', (select count(*) from public.rider_verifications where status = 'pending'),
      'live_orders', (select count(*) from public.orders where status in ('pending', 'accepted', 'preparing', 'ready', 'out_for_delivery')),
      'available_riders', (
        select count(*)
        from public.delivery_partners dp
        join public.rider_verifications rv on rv.rider_id = dp.id and rv.status = 'verified'
        where dp.is_available
      )
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
               dp.vehicle_type, dp.is_available, dp.created_at,
               coalesce(rv.status, 'unverified') as verification_status,
               rv.plate_number
        from public.delivery_partners dp
        left join public.profiles profile on profile.id = dp.id
        left join public.rider_verifications rv on rv.rider_id = dp.id
        order by dp.created_at desc
        limit 100
      ) recent_riders
    ), '[]'::jsonb)
  ) into snapshot;
  return snapshot;
end;
$$;

revoke all on function public.request_store_verification(uuid, text, text) from public, anon;
revoke all on function public.get_store_verification_queue() from public, anon;
revoke all on function public.request_rider_verification(text, text, text, text) from public, anon;
revoke all on function public.get_rider_verification_queue() from public, anon;
revoke all on function public.review_rider_verification(uuid, boolean) from public, anon;
revoke all on function public.get_rider_verification_status() from public, anon;
revoke all on function public.get_admin_dashboard_snapshot() from public, anon;

grant execute on function public.request_store_verification(uuid, text, text) to authenticated;
grant execute on function public.get_store_verification_queue() to authenticated;
grant execute on function public.request_rider_verification(text, text, text, text) to authenticated;
grant execute on function public.get_rider_verification_queue() to authenticated;
grant execute on function public.review_rider_verification(uuid, boolean) to authenticated;
grant execute on function public.get_rider_verification_status() to authenticated;
grant execute on function public.get_admin_dashboard_snapshot() to authenticated;
revoke all on function public.require_verified_rider_for_availability() from public, anon, authenticated;

create or replace function public.notify_riders_when_order_ready()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.status = 'ready' and old.status is distinct from new.status then
    insert into public.user_notifications (
      user_id, order_id, event_type, event_key, title, body
    )
    select dp.id, new.id, 'order_ready',
           'order_ready:' || new.id::text,
           'Delivery pickup available',
           'Order #' || left(new.id::text, 6) || ' is ready for pickup.'
    from public.delivery_partners dp
    join public.profiles p on p.id = dp.id
    join public.rider_verifications rv on rv.rider_id = dp.id and rv.status = 'verified'
    where dp.is_available = true and p.role = 'delivery'
    on conflict (user_id, event_key) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_riders_when_order_ready() from public, anon, authenticated;

commit;
