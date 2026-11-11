create table if not exists public.delivery_order_locations (
  order_id uuid primary key references public.orders(id) on delete cascade,
  rider_id uuid not null references public.profiles(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision check (accuracy_m is null or accuracy_m >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists delivery_order_locations_rider_id_idx
  on public.delivery_order_locations(rider_id);

alter table public.delivery_order_locations enable row level security;

revoke all on public.delivery_order_locations from anon;
grant select, insert, update on public.delivery_order_locations to authenticated;

drop policy if exists "Buyers and assigned riders can view active delivery locations"
  on public.delivery_order_locations;
create policy "Buyers and assigned riders can view active delivery locations"
  on public.delivery_order_locations for select
  using (
    (
      public.is_order_buyer(order_id)
      and exists (
        select 1 from public.orders o
        where o.id = order_id
          and o.status = 'out_for_delivery'
      )
    )
    or (
      rider_id = auth.uid()
      and exists (
        select 1 from public.orders o
        where o.id = order_id
          and o.assigned_delivery_id = auth.uid()
          and o.status = 'out_for_delivery'
      )
    )
  );

drop policy if exists "Assigned riders can publish their active delivery location"
  on public.delivery_order_locations;
create policy "Assigned riders can publish their active delivery location"
  on public.delivery_order_locations for insert
  with check (
    rider_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.assigned_delivery_id = auth.uid()
        and o.status = 'out_for_delivery'
    )
  );

drop policy if exists "Assigned riders can update their active delivery location"
  on public.delivery_order_locations;
create policy "Assigned riders can update their active delivery location"
  on public.delivery_order_locations for update
  using (
    rider_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.assigned_delivery_id = auth.uid()
        and o.status = 'out_for_delivery'
    )
  )
  with check (
    rider_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.assigned_delivery_id = auth.uid()
        and o.status = 'out_for_delivery'
    )
  );

create or replace function public.clear_inactive_delivery_location()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from 'out_for_delivery'
    or new.assigned_delivery_id is distinct from old.assigned_delivery_id then
    delete from public.delivery_order_locations where order_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_inactive_delivery_location on public.orders;
create trigger clear_inactive_delivery_location
  after update of status, assigned_delivery_id on public.orders
  for each row execute procedure public.clear_inactive_delivery_location();

do $$
begin
  alter publication supabase_realtime
    add table public.delivery_order_locations;
exception
  when duplicate_object then null;
end;
$$;
