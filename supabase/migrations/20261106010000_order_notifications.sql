create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null check (event_type in ('new_order', 'order_ready')),
  event_key text not null,
  title text not null,
  body text not null,
  read_at timestamptz,
  push_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
);

create index if not exists user_notifications_user_created_at_idx
  on public.user_notifications(user_id, created_at desc);

alter table public.user_notifications enable row level security;
revoke all on public.user_notifications from anon, authenticated;
grant select on public.user_notifications to authenticated;
grant update (read_at) on public.user_notifications to authenticated;
grant all on public.user_notifications to service_role;

drop policy if exists "Users can view their notifications" on public.user_notifications;
create policy "Users can view their notifications"
  on public.user_notifications for select
  using (user_id = auth.uid());

drop policy if exists "Users can mark their notifications read" on public.user_notifications;
create policy "Users can mark their notifications read"
  on public.user_notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public.notification_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

create index if not exists notification_push_tokens_user_id_idx
  on public.notification_push_tokens(user_id);

alter table public.notification_push_tokens enable row level security;
revoke all on public.notification_push_tokens from anon, authenticated;
grant select, insert, update, delete on public.notification_push_tokens to authenticated;
grant all on public.notification_push_tokens to service_role;

drop policy if exists "Users can manage their own push tokens" on public.notification_push_tokens;
create policy "Users can manage their own push tokens"
  on public.notification_push_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.notify_sellers_of_new_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  insert into public.user_notifications (
    user_id, order_id, event_type, event_key, title, body
  )
  select distinct
    s.owner_id,
    o.id,
    'new_order',
    'new_order:' || o.id::text,
    'New order received',
    'A buyer placed order #' || left(o.id::text, 6) || '. Review it in your seller dashboard.'
  from inserted_order_items new_item
  join public.orders o on o.id = new_item.order_id
  join public.order_items oi on oi.order_id = o.id
  join public.products p on p.id = oi.product_id
  join public.stores s on s.id = p.store_id
  where o.status = 'pending'
  on conflict (user_id, event_key) do nothing;

  return null;
end;
$$;
revoke all on function public.notify_sellers_of_new_order() from public, anon, authenticated;

drop trigger if exists notify_sellers_after_order_items_insert on public.order_items;
create trigger notify_sellers_after_order_items_insert
  after insert on public.order_items
  referencing new table as inserted_order_items
  for each statement execute procedure public.notify_sellers_of_new_order();

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
    select
      dp.id,
      new.id,
      'order_ready',
      'order_ready:' || new.id::text,
      'Delivery pickup available',
      'Order #' || left(new.id::text, 6) || ' is ready for pickup.'
    from public.delivery_partners dp
    join public.profiles p on p.id = dp.id
    where dp.is_available = true
      and p.role = 'delivery'
    on conflict (user_id, event_key) do nothing;
  end if;

  return new;
end;
$$;
revoke all on function public.notify_riders_when_order_ready() from public, anon, authenticated;

drop trigger if exists notify_riders_after_order_ready on public.orders;
create trigger notify_riders_after_order_ready
  after update of status on public.orders
  for each row execute procedure public.notify_riders_when_order_ready();

do $$
begin
  alter publication supabase_realtime add table public.user_notifications;
exception
  when duplicate_object then null;
end;
$$;
