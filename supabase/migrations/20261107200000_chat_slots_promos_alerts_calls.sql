begin;

alter table public.orders
  add column if not exists delivery_slot text not null default 'flexible',
  add column if not exists promo_id uuid,
  add column if not exists promo_store_id uuid references public.stores(id),
  add column if not exists promo_code text,
  add column if not exists promo_discount numeric(10, 2) not null default 0
    check (promo_discount >= 0);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_delivery_slot_check'
  ) then
    alter table public.orders add constraint orders_delivery_slot_check
      check (delivery_slot in ('flexible', 'morning', 'afternoon', 'evening'));
  end if;
end;
$$;

alter table public.profiles
  add column if not exists phone_number text not null default '',
  add column if not exists rider_phone_sharing boolean not null default false;

create table if not exists public.order_chat_threads (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (order_id, store_id)
);

create table if not exists public.order_chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.order_chat_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists order_chat_messages_thread_created_idx
  on public.order_chat_messages(thread_id, created_at);

alter table public.order_chat_threads enable row level security;
alter table public.order_chat_messages enable row level security;
revoke all on public.order_chat_threads, public.order_chat_messages from anon, authenticated;
grant select on public.order_chat_threads, public.order_chat_messages to authenticated;

drop policy if exists "Order chat participants can view threads" on public.order_chat_threads;
create policy "Order chat participants can view threads"
  on public.order_chat_threads for select to authenticated
  using (auth.uid() = buyer_id or auth.uid() = seller_id);

drop policy if exists "Order chat participants can view messages" on public.order_chat_messages;
create policy "Order chat participants can view messages"
  on public.order_chat_messages for select to authenticated
  using (
    exists (
      select 1 from public.order_chat_threads thread
      where thread.id = order_chat_messages.thread_id
        and (thread.buyer_id = auth.uid() or thread.seller_id = auth.uid())
    )
  );

create or replace function public.get_or_create_order_chat(p_order_id uuid, p_store_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  order_row public.orders%rowtype;
  seller_user_id uuid;
  chat_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to open order chat.'; end if;
  select * into order_row from public.orders where id = p_order_id;
  if not found or order_row.status = 'cancelled' then raise exception 'This order is not available for chat.'; end if;
  select store.owner_id into seller_user_id
  from public.stores store
  where store.id = p_store_id
    and exists (
      select 1 from public.order_items item
      join public.products product on product.id = item.product_id
      where item.order_id = p_order_id and product.store_id = p_store_id
    );
  if seller_user_id is null or (auth.uid() <> order_row.buyer_id and auth.uid() <> seller_user_id) then
    raise exception 'Only this order’s buyer and seller can open this chat.';
  end if;

  insert into public.order_chat_threads (order_id, store_id, buyer_id, seller_id)
  values (p_order_id, p_store_id, order_row.buyer_id, seller_user_id)
  on conflict (order_id, store_id) do update set order_id = excluded.order_id
  returning id into chat_id;
  return chat_id;
end;
$$;

create or replace function public.send_order_chat_message(p_thread_id uuid, p_message text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  new_message_id uuid;
begin
  if auth.uid() is null
    or char_length(trim(coalesce(p_message, ''))) not between 1 and 2000 then
    raise exception 'Enter a message between 1 and 2000 characters.';
  end if;
  if not exists (
    select 1 from public.order_chat_threads
    where id = p_thread_id and (buyer_id = auth.uid() or seller_id = auth.uid())
  ) then raise exception 'You are not a participant in this order chat.'; end if;
  insert into public.order_chat_messages (thread_id, sender_id, message)
  values (p_thread_id, auth.uid(), trim(p_message))
  returning id into new_message_id;
  return new_message_id;
end;
$$;

revoke all on function public.get_or_create_order_chat(uuid, uuid) from public, anon;
revoke all on function public.send_order_chat_message(uuid, text) from public, anon;
grant execute on function public.get_or_create_order_chat(uuid, uuid) to authenticated;
grant execute on function public.send_order_chat_message(uuid, text) to authenticated;

create table if not exists public.store_promos (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  code text not null unique check (code = upper(code) and char_length(code) between 4 and 20),
  percent_off smallint not null default 10 check (percent_off = 10),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (store_id)
);

create table if not exists public.store_promo_redemptions (
  promo_id uuid not null references public.store_promos(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (promo_id, buyer_id)
);

alter table public.store_promos enable row level security;
alter table public.store_promo_redemptions enable row level security;
revoke all on public.store_promos, public.store_promo_redemptions from anon, authenticated;
grant select on public.store_promos to authenticated;
grant select on public.store_promo_redemptions to authenticated;

drop policy if exists "Sellers view and manage their promo codes" on public.store_promos;
create policy "Sellers view and manage their promo codes"
  on public.store_promos for select to authenticated
  using (exists (select 1 from public.stores where id = store_id and owner_id = auth.uid()));

drop policy if exists "Sellers view their promo redemptions" on public.store_promo_redemptions;
create policy "Sellers view their promo redemptions"
  on public.store_promo_redemptions for select to authenticated
  using (exists (
    select 1 from public.store_promos promo
    join public.stores store on store.id = promo.store_id
    where promo.id = promo_id and store.owner_id = auth.uid()
  ));

create or replace function public.create_store_promo(p_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  seller_store_id uuid;
  normalized_code text := upper(trim(coalesce(p_code, '')));
begin
  if auth.uid() is null then raise exception 'Sign in as a seller to create a promo code.'; end if;
  if normalized_code !~ '^[A-Z0-9]{4,20}$' then
    raise exception 'Use 4–20 letters or numbers for the promo code.';
  end if;
  select id into seller_store_id from public.stores where owner_id = auth.uid() order by created_at limit 1;
  if seller_store_id is null then raise exception 'Create your store before adding a promo code.'; end if;
  insert into public.store_promos (store_id, code)
  values (seller_store_id, normalized_code)
  on conflict (store_id) do update set code = excluded.code, active = true;
exception
  when unique_violation then raise exception 'That promo code is already in use. Choose another code.';
end;
$$;

create or replace function public.deactivate_store_promo()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  update public.store_promos promo set active = false
  from public.stores store
  where promo.store_id = store.id and store.owner_id = auth.uid() and promo.active;
  if not found then raise exception 'There is no active promo code to turn off.'; end if;
end;
$$;

create or replace function public.preview_store_promo(p_code text, p_product_ids uuid[])
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  promo_row public.store_promos%rowtype;
  seller_subtotal numeric(10, 2);
begin
  if auth.uid() is null then raise exception 'Sign in to apply a promo code.'; end if;
  select * into promo_row from public.store_promos
  where code = upper(trim(coalesce(p_code, ''))) and active;
  if not found then raise exception 'This promo code is invalid or inactive.'; end if;
  if exists (select 1 from public.store_promo_redemptions where promo_id = promo_row.id and buyer_id = auth.uid()) then
    raise exception 'You have already used this promo code.';
  end if;
  select coalesce(sum(product.price), 0) into seller_subtotal
  from unnest(p_product_ids) requested(product_id)
  join public.products product on product.id = requested.product_id
  where product.store_id = promo_row.store_id;
  if seller_subtotal <= 0 then raise exception 'Your cart has no products from this store.'; end if;
  return round(seller_subtotal * promo_row.percent_off / 100.0, 2);
end;
$$;

create or replace function public.create_marketplace_order_with_options(
  p_delivery_address text,
  p_payment_method text,
  p_product_ids uuid[],
  p_delivery_slot text,
  p_promo_code text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  new_order_id uuid;
  promo_row public.store_promos%rowtype;
  seller_subtotal numeric(10, 2);
  discount numeric(10, 2) := 0;
begin
  if p_delivery_slot not in ('morning', 'afternoon', 'evening') then
    raise exception 'Choose a valid delivery time window.';
  end if;
  new_order_id := public.create_marketplace_order(p_delivery_address, p_payment_method, p_product_ids);
  if nullif(trim(coalesce(p_promo_code, '')), '') is not null then
    select * into promo_row from public.store_promos
    where code = upper(trim(p_promo_code)) and active
    for update;
    if not found then raise exception 'This promo code is invalid or inactive.'; end if;
    if exists (select 1 from public.store_promo_redemptions where promo_id = promo_row.id and buyer_id = auth.uid()) then
      raise exception 'You have already used this promo code.';
    end if;
    select coalesce(sum(item.quantity * item.unit_price), 0) into seller_subtotal
    from public.order_items item
    join public.products product on product.id = item.product_id
    where item.order_id = new_order_id and product.store_id = promo_row.store_id;
    if seller_subtotal <= 0 then raise exception 'Your cart has no products from this store.'; end if;
    discount := round(seller_subtotal * promo_row.percent_off / 100.0, 2);
    update public.orders
    set promo_id = promo_row.id,
        promo_store_id = promo_row.store_id,
        promo_code = promo_row.code,
        promo_discount = discount,
        total = total - discount
    where id = new_order_id;
    insert into public.store_promo_redemptions (promo_id, buyer_id, order_id)
    values (promo_row.id, auth.uid(), new_order_id);
  end if;
  update public.orders set delivery_slot = p_delivery_slot where id = new_order_id;
  return new_order_id;
end;
$$;

create or replace function public.release_cancelled_promo_redemption()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from new.status then
    delete from public.store_promo_redemptions where order_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists release_cancelled_promo_redemption on public.orders;
create trigger release_cancelled_promo_redemption
  after update of status on public.orders for each row
  execute function public.release_cancelled_promo_redemption();

revoke all on function public.create_store_promo(text) from public, anon;
revoke all on function public.deactivate_store_promo() from public, anon;
revoke all on function public.preview_store_promo(text, uuid[]) from public, anon;
revoke all on function public.create_marketplace_order_with_options(text, text, uuid[], text, text) from public, anon;
grant execute on function public.create_store_promo(text) to authenticated;
grant execute on function public.deactivate_store_promo() to authenticated;
grant execute on function public.preview_store_promo(text, uuid[]) to authenticated;
grant execute on function public.create_marketplace_order_with_options(text, text, uuid[], text, text) to authenticated;

create table if not exists public.product_stock_alerts (
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (buyer_id, product_id)
);

create table if not exists public.marketplace_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  alert_type text not null check (alert_type in ('back_in_stock', 'low_stock')),
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists marketplace_alerts_user_created_idx
  on public.marketplace_alerts(user_id, created_at desc);
alter table public.product_stock_alerts enable row level security;
alter table public.marketplace_alerts enable row level security;
revoke all on public.product_stock_alerts, public.marketplace_alerts from anon, authenticated;
grant select, insert, delete on public.product_stock_alerts to authenticated;
grant select on public.marketplace_alerts to authenticated;
grant update (read_at) on public.marketplace_alerts to authenticated;

drop policy if exists "Buyers manage their stock alerts" on public.product_stock_alerts;
create policy "Buyers manage their stock alerts"
  on public.product_stock_alerts for all to authenticated
  using (buyer_id = auth.uid())
  with check (buyer_id = auth.uid());
drop policy if exists "Users view and mark their marketplace alerts" on public.marketplace_alerts;
create policy "Users view and mark their marketplace alerts"
  on public.marketplace_alerts for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users mark their marketplace alerts read" on public.marketplace_alerts;
create policy "Users mark their marketplace alerts read"
  on public.marketplace_alerts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.notify_product_stock_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.stock_quantity > 0 and new.is_available
    and (old.stock_quantity <= 0 or old.is_available is false) then
    insert into public.marketplace_alerts (user_id, product_id, alert_type, message)
    select alert.buyer_id, new.id, 'back_in_stock',
      new.name || ' is back in stock at ' || store.name || '.'
    from public.product_stock_alerts alert
    join public.stores store on store.id = new.store_id
    where alert.product_id = new.id
    on conflict do nothing;
    update public.product_stock_alerts
    set notified_at = now()
    where product_id = new.id and notified_at is null;
  end if;

  if new.stock_quantity > 0 and new.stock_quantity <= 5 and new.is_available
    and (old.stock_quantity > 5 or old.stock_quantity <= 0 or old.is_available is false) then
    insert into public.marketplace_alerts (user_id, product_id, alert_type, message)
    select store.owner_id, new.id, 'low_stock',
      new.name || ' is low on stock (' || new.stock_quantity || ' left).'
    from public.stores store where store.id = new.store_id;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_product_stock_changes on public.products;
create trigger notify_product_stock_changes
  after update of stock_quantity, is_available on public.products
  for each row execute function public.notify_product_stock_changes();

create or replace function public.get_active_delivery_contact(p_order_id uuid)
returns table (phone_number text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.orders order_row
    join public.profiles buyer on buyer.id = order_row.buyer_id
    where order_row.id = p_order_id
      and buyer.id = auth.uid()
      and order_row.status = 'out_for_delivery'
      and order_row.assigned_delivery_id is not null
  ) then raise exception 'Rider contact is available only to the buyer during an active assigned delivery.'; end if;
  return query
  select rider.phone_number
  from public.orders order_row
  join public.profiles rider on rider.id = order_row.assigned_delivery_id
  where order_row.id = p_order_id
    and rider.role = 'delivery'
    and rider.rider_phone_sharing
    and length(regexp_replace(rider.phone_number, '[^0-9]', '', 'g')) between 10 and 15
    and order_row.status = 'out_for_delivery';
end;
$$;
revoke all on function public.get_active_delivery_contact(uuid) from public, anon;
grant execute on function public.get_active_delivery_contact(uuid) to authenticated;

create or replace function public.set_my_rider_call_contact(p_phone_number text, p_share boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  normalized_phone text := trim(coalesce(p_phone_number, ''));
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'delivery'
  ) then raise exception 'A delivery partner account is required.'; end if;
  if p_share is null
    or (p_share and length(regexp_replace(normalized_phone, '[^0-9]', '', 'g')) not between 10 and 15) then
    raise exception 'Enter a valid phone number before enabling buyer calls.';
  end if;
  update public.profiles
  set phone_number = normalized_phone,
      rider_phone_sharing = p_share,
      updated_at = now()
  where id = auth.uid();
end;
$$;
revoke all on function public.set_my_rider_call_contact(text, boolean) from public, anon;
grant execute on function public.set_my_rider_call_contact(text, boolean) to authenticated;

create or replace function public.get_order_delivery_slots(p_order_ids uuid[])
returns table (order_id uuid, delivery_slot text)
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select order_row.id, order_row.delivery_slot
  from public.orders order_row
  where order_row.id = any(coalesce(p_order_ids, '{}'::uuid[]))
    and auth.uid() is not null
    and (
      order_row.buyer_id = auth.uid()
      or order_row.assigned_delivery_id = auth.uid()
      or exists (
        select 1
        from public.order_items item
        join public.products product on product.id = item.product_id
        join public.stores store on store.id = product.store_id
        where item.order_id = order_row.id and store.owner_id = auth.uid()
      )
    );
$$;
revoke all on function public.get_order_delivery_slots(uuid[]) from public, anon;
grant execute on function public.get_order_delivery_slots(uuid[]) to authenticated;

create or replace function public.get_order_seller_promo_details(p_order_ids uuid[])
returns table (order_id uuid, promo_code text, promo_discount numeric)
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select order_row.id, order_row.promo_code, order_row.promo_discount
  from public.orders order_row
  where order_row.id = any(coalesce(p_order_ids, '{}'::uuid[]))
    and order_row.promo_store_id is not null
    and auth.uid() is not null
    and exists (
      select 1
      from public.stores store
      where store.id = order_row.promo_store_id and store.owner_id = auth.uid()
    );
$$;
revoke all on function public.get_order_seller_promo_details(uuid[]) from public, anon;
grant execute on function public.get_order_seller_promo_details(uuid[]) to authenticated;

create or replace function public.create_completed_order_payouts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status
    and not new.payment_simulated then
    insert into public.marketplace_payouts (order_id, beneficiary_id, payout_type, amount)
    select new.id, store.owner_id, 'seller',
      greatest(0, round(sum(item.quantity * item.unit_price)
        - case when bool_or(store.id = new.promo_store_id) then new.promo_discount else 0 end, 2))
    from public.order_items item
    join public.products product on product.id = item.product_id
    join public.stores store on store.id = product.store_id
    group by store.owner_id
    having greatest(0, round(sum(item.quantity * item.unit_price)
      - case when bool_or(store.id = new.promo_store_id) then new.promo_discount else 0 end, 2)) > 0
    on conflict (order_id, beneficiary_id, payout_type) do nothing;

    if new.assigned_delivery_id is not null then
      insert into public.marketplace_payouts (order_id, beneficiary_id, payout_type, amount)
      values (new.id, new.assigned_delivery_id, 'rider', 1500)
      on conflict (order_id, beneficiary_id, payout_type) do nothing;
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.order_chat_messages;
exception
  when duplicate_object then null;
end;
$$;

commit;
