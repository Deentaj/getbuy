begin;

create table if not exists public.order_delivery_fulfillments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  market_area text not null,
  pickup_details text not null default '',
  rider_id uuid references public.profiles(id) on delete set null,
  recommended_fee numeric(10, 2) not null check (recommended_fee >= 0),
  offered_fee numeric(10, 2) check (offered_fee >= recommended_fee),
  status text not null default 'awaiting_rider'
    check (status in ('awaiting_rider', 'offered', 'approved', 'ready', 'out_for_delivery', 'completed', 'cancelled')),
  delivery_proof_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, market_area)
);

create index if not exists order_delivery_fulfillments_order_idx
  on public.order_delivery_fulfillments(order_id);
create index if not exists order_delivery_fulfillments_rider_idx
  on public.order_delivery_fulfillments(rider_id, status);

alter table public.user_notifications
  drop constraint if exists user_notifications_event_type_check;
alter table public.user_notifications
  add constraint user_notifications_event_type_check
  check (event_type in (
    'new_order', 'order_ready', 'new_chat_message', 'product_back_in_stock',
    'product_low_stock', 'loyalty_reward', 'referral_reward', 'order_cancelled',
    'cancellation_update', 'refund_update', 'support_update', 'delivery_fee_request'
  ));

alter table public.order_delivery_fulfillments enable row level security;
revoke all on public.order_delivery_fulfillments from anon, authenticated;
grant select on public.order_delivery_fulfillments to authenticated;

drop policy if exists "Buyers and assigned riders can view delivery fulfillments" on public.order_delivery_fulfillments;
create policy "Buyers and assigned riders can view delivery fulfillments"
  on public.order_delivery_fulfillments for select to authenticated
  using (
    exists (
      select 1 from public.orders order_row
      where order_row.id = order_delivery_fulfillments.order_id
        and order_row.buyer_id = auth.uid()
    )
    or rider_id = auth.uid()
    or public.is_admin()
  );

drop policy if exists "Assigned riders can upload delivery proof" on storage.objects;
create policy "Assigned riders can upload delivery proof"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'delivery-proofs'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1
      from public.orders order_row
      join public.profiles rider on rider.id = auth.uid() and rider.role = 'delivery'
      where order_row.id::text = (storage.foldername(name))[1]
        and order_row.status = 'out_for_delivery'
        and (
          order_row.assigned_delivery_id = auth.uid()
          or exists (
            select 1 from public.order_delivery_fulfillments fulfillment
            where fulfillment.order_id = order_row.id
              and fulfillment.rider_id = auth.uid()
              and fulfillment.status = 'out_for_delivery'
          )
        )
    )
  );

drop policy if exists "Order participants can view delivery proof" on storage.objects;
create policy "Order participants can view delivery proof"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'delivery-proofs'
    and exists (
      select 1 from public.orders order_row
      where order_row.id::text = (storage.foldername(name))[1]
        and (
          order_row.buyer_id = auth.uid()
          or order_row.assigned_delivery_id = auth.uid()
          or public.is_admin()
          or exists (
            select 1 from public.order_delivery_fulfillments fulfillment
            where fulfillment.order_id = order_row.id and fulfillment.rider_id = auth.uid()
          )
        )
    )
  );

create or replace function public.create_order_delivery_fulfillments()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  insert into public.order_delivery_fulfillments (
    order_id, market_area, pickup_details, recommended_fee
  )
  select
    order_row.id,
    lower(trim(coalesce(nullif(store.market_area, ''), 'Unspecified market'))),
    coalesce(string_agg(distinct nullif(trim(store.pickup_details), ''), ' · '), ''),
    case when lower(trim(order_row.delivery_address)) like '%kubwa%' then 1000 else 2000 end
  from inserted_items inserted_item
  join public.orders order_row on order_row.id = inserted_item.order_id
  join public.products product on product.id = inserted_item.product_id
  join public.stores store on store.id = product.store_id
  where order_row.payment_status = 'pending'
  group by order_row.id, lower(trim(coalesce(nullif(store.market_area, ''), 'Unspecified market')))
  on conflict (order_id, market_area) do nothing;
  return null;
end;
$$;

revoke all on function public.create_order_delivery_fulfillments() from public, anon, authenticated;
drop trigger if exists create_order_delivery_fulfillments_after_items on public.order_items;
create trigger create_order_delivery_fulfillments_after_items
  after insert on public.order_items
  referencing new table as inserted_items
  for each statement execute function public.create_order_delivery_fulfillments();

create or replace function public.notify_riders_delivery_fee_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.status = 'awaiting_rider' then
    insert into public.user_notifications (
      user_id, order_id, event_type, event_key, title, body, payload
    )
    select partner.id, new.order_id, 'delivery_fee_request',
      'delivery_fee_request:' || new.id::text || ':' || partner.id::text,
      'Delivery fee requested',
      'A buyer needs a final delivery amount for pickup in ' || new.market_area || '.',
      jsonb_build_object('fulfillment_id', new.id, 'market_area', new.market_area)
    from public.delivery_partners partner
    join public.profiles profile on profile.id = partner.id and profile.role = 'delivery'
    join public.rider_verifications verification on verification.rider_id = partner.id and verification.status = 'verified'
    where partner.is_available
    on conflict (user_id, event_key) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.notify_riders_delivery_fee_request() from public, anon, authenticated;
drop trigger if exists notify_riders_delivery_fee_request on public.order_delivery_fulfillments;
create trigger notify_riders_delivery_fee_request
  after insert on public.order_delivery_fulfillments
  for each row execute function public.notify_riders_delivery_fee_request();

insert into public.order_delivery_fulfillments (
  order_id, market_area, pickup_details, rider_id, recommended_fee, offered_fee, status
)
select
  order_row.id,
  lower(trim(coalesce(nullif(store.market_area, ''), 'Unspecified market'))),
  coalesce(string_agg(distinct nullif(trim(store.pickup_details), ''), ' · '), ''),
  order_row.assigned_delivery_id,
  case when lower(trim(order_row.delivery_address)) like '%kubwa%' then 1000 else 2000 end,
  case when lower(trim(order_row.delivery_address)) like '%kubwa%' then 1000 else 2000 end,
  case
    when order_row.status = 'cancelled' then 'cancelled'
    when order_row.status = 'completed' then 'completed'
    when order_row.status = 'out_for_delivery' then 'out_for_delivery'
    when order_row.status = 'ready' then 'ready'
    when order_row.payment_status = 'paid' then 'approved'
    else 'awaiting_rider'
  end
from public.orders order_row
join public.order_items item on item.order_id = order_row.id
join public.products product on product.id = item.product_id
join public.stores store on store.id = product.store_id
group by order_row.id, order_row.assigned_delivery_id, order_row.delivery_address,
  order_row.status, order_row.payment_status,
  lower(trim(coalesce(nullif(store.market_area, ''), 'Unspecified market')))
on conflict (order_id, market_area) do nothing;

create or replace function public.get_buyer_delivery_fulfillments(p_order_ids uuid[])
returns table (
  order_id uuid,
  id uuid,
  market_area text,
  pickup_details text,
  rider_id uuid,
  rider_name text,
  recommended_fee numeric,
  offered_fee numeric,
  status text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or (
    not public.is_admin()
    and not exists (
      select 1 from public.orders order_row
      where order_row.id = any(p_order_ids) and order_row.buyer_id = auth.uid()
    )
  ) then
    raise exception 'Only the buyer or an administrator can view delivery fees for this order.';
  end if;

  return query
  select fulfillment.order_id, fulfillment.id, fulfillment.market_area, fulfillment.pickup_details,
    fulfillment.rider_id, coalesce(rider.full_name, ''), fulfillment.recommended_fee,
    fulfillment.offered_fee, fulfillment.status
  from public.order_delivery_fulfillments fulfillment
  left join public.profiles rider on rider.id = fulfillment.rider_id
  where fulfillment.order_id = any(p_order_ids)
    and exists (
      select 1 from public.orders order_row
      where order_row.id = fulfillment.order_id
        and (order_row.buyer_id = auth.uid() or public.is_admin())
    )
  order by fulfillment.order_id, fulfillment.market_area;
end;
$$;

drop function if exists public.get_active_delivery_contact(uuid);
create function public.get_active_delivery_contact(
  p_order_id uuid,
  p_fulfillment_id uuid default null
)
returns table (phone_number text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.orders order_row
    where order_row.id = p_order_id
      and order_row.status = 'out_for_delivery'
      and (
        order_row.buyer_id = auth.uid()
        or order_row.assigned_delivery_id = auth.uid()
        or exists (
          select 1 from public.order_delivery_fulfillments fulfillment
          where fulfillment.order_id = order_row.id
            and (p_fulfillment_id is null or fulfillment.id = p_fulfillment_id)
            and fulfillment.rider_id = auth.uid()
            and fulfillment.status = 'out_for_delivery'
        )
      )
  ) then
    raise exception 'Contact details are available only to the buyer and assigned rider during an active delivery.';
  end if;

  return query
  select case
    when order_row.buyer_id = auth.uid()
      and rider.rider_phone_sharing
      and length(regexp_replace(rider.phone_number, '[^0-9]', '', 'g')) between 10 and 15
      then rider.phone_number
    when (
      order_row.assigned_delivery_id = auth.uid()
      or fulfillment.rider_id = auth.uid()
    )
      and length(regexp_replace(buyer.phone_number, '[^0-9]', '', 'g')) between 10 and 15
      then buyer.phone_number
    else null
  end
  from public.orders order_row
  join public.profiles buyer on buyer.id = order_row.buyer_id
  left join lateral (
    select group_row.rider_id
    from public.order_delivery_fulfillments group_row
    where group_row.order_id = order_row.id
      and group_row.status = 'out_for_delivery'
      and group_row.rider_id is not null
      and (p_fulfillment_id is null or group_row.id = p_fulfillment_id)
      and (
        order_row.buyer_id = auth.uid()
        or group_row.rider_id = auth.uid()
      )
    order by group_row.market_area
    limit 1
  ) fulfillment on true
  left join public.profiles rider on rider.id = coalesce(fulfillment.rider_id, order_row.assigned_delivery_id)
  where order_row.id = p_order_id
    and order_row.status = 'out_for_delivery'
    and rider.role = 'delivery';
end;
$$;

revoke all on function public.get_active_delivery_contact(uuid, uuid) from public, anon;
grant execute on function public.get_active_delivery_contact(uuid, uuid) to authenticated;

create or replace function public.get_available_delivery_fee_offers()
returns table (
  fulfillment_id uuid,
  order_id uuid,
  market_area text,
  pickup_details text,
  delivery_address text,
  recommended_fee numeric,
  items_summary text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    join public.delivery_partners partner on partner.id = profile.id
    join public.rider_verifications verification on verification.rider_id = profile.id
    where profile.id = auth.uid()
      and profile.role = 'delivery'
      and partner.is_available
      and verification.status = 'verified'
  ) then
    raise exception 'A verified, available delivery account is required to view fee offers.';
  end if;

  return query
  select fulfillment.id, order_row.id, fulfillment.market_area,
    fulfillment.pickup_details, order_row.delivery_address, fulfillment.recommended_fee,
    coalesce((
      select string_agg(format('%s %s %s', item.quantity, product.unit, product.name), ' + ' order by product.name)
      from public.order_items item
      join public.products product on product.id = item.product_id
      join public.stores store on store.id = product.store_id
      where item.order_id = order_row.id
        and lower(trim(coalesce(nullif(store.market_area, ''), 'Unspecified market'))) = fulfillment.market_area
    ), 'Order items unavailable')
  from public.order_delivery_fulfillments fulfillment
  join public.orders order_row on order_row.id = fulfillment.order_id
  where fulfillment.status = 'awaiting_rider'
    and order_row.status = 'pending'
    and order_row.payment_method = 'monnify'
    and order_row.payment_status = 'pending'
  order by fulfillment.created_at;
end;
$$;

create or replace function public.submit_delivery_fee_offer(
  p_fulfillment_id uuid,
  p_offered_fee numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  fulfillment public.order_delivery_fulfillments%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    join public.delivery_partners partner on partner.id = profile.id
    join public.rider_verifications verification on verification.rider_id = profile.id
    where profile.id = auth.uid()
      and profile.role = 'delivery'
      and partner.is_available
      and verification.status = 'verified'
  ) then
    raise exception 'A verified, available delivery account is required to offer a fee.';
  end if;
  if p_offered_fee is null or p_offered_fee < 0 or p_offered_fee > 1000000
    or p_offered_fee <> round(p_offered_fee, 2) then
    raise exception 'Enter a valid delivery amount.';
  end if;

  select * into fulfillment
  from public.order_delivery_fulfillments
  where id = p_fulfillment_id and status = 'awaiting_rider'
  for update;
  if not found then
    raise exception 'Another rider has already offered for this delivery, or it is no longer available.';
  end if;
  if p_offered_fee < fulfillment.recommended_fee then
    raise exception 'Your final delivery amount cannot be below the recommended fee.';
  end if;
  if not exists (
    select 1 from public.orders order_row
    where order_row.id = fulfillment.order_id
      and order_row.status = 'pending'
      and order_row.payment_status = 'pending'
  ) then
    raise exception 'This order is no longer waiting for rider fee offers.';
  end if;

  update public.order_delivery_fulfillments
  set rider_id = auth.uid(), offered_fee = p_offered_fee, status = 'offered', updated_at = now()
  where id = p_fulfillment_id;
end;
$$;

create or replace function public.approve_order_delivery_fees(p_order_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  order_row public.orders%rowtype;
  fulfillment_count integer;
  offered_count integer;
  approved_count integer;
  approved_delivery_total numeric(12, 2);
  original_delivery_fee numeric(10, 2);
  updated_total numeric(12, 2);
begin
  select * into order_row
  from public.orders
  where id = p_order_id and buyer_id = auth.uid()
  for update;
  if not found then
    raise exception 'This order was not found for your account.';
  end if;
  if order_row.payment_status <> 'pending' or order_row.status <> 'pending' then
    raise exception 'Delivery fees can only be approved before payment.';
  end if;

  select count(*),
    count(*) filter (where status = 'offered' and rider_id is not null and offered_fee is not null),
    count(*) filter (where status = 'approved'),
    coalesce(sum(offered_fee), 0)
  into fulfillment_count, offered_count, approved_count, approved_delivery_total
  from public.order_delivery_fulfillments
  where order_id = p_order_id;
  if fulfillment_count > 0 and approved_count = fulfillment_count then
    return order_row.total;
  end if;
  if fulfillment_count = 0 or fulfillment_count <> offered_count then
    raise exception 'Wait until a rider has offered a final amount for every pickup location.';
  end if;

  original_delivery_fee := case
    when lower(trim(order_row.delivery_address)) like '%kubwa%' then 1000
    else 2000
  end;
  updated_total := order_row.total - original_delivery_fee + approved_delivery_total;
  if updated_total < 0 then
    raise exception 'The final order total could not be calculated.';
  end if;

  update public.order_delivery_fulfillments
  set status = 'approved', updated_at = now()
  where order_id = p_order_id and status = 'offered';

  update public.orders
  set total = updated_total,
      assigned_delivery_id = (
        select rider_id from public.order_delivery_fulfillments
        where order_id = p_order_id order by market_area limit 1
      ),
      updated_at = now()
  where id = p_order_id;

  return updated_total;
end;
$$;

create or replace function public.require_delivery_fee_approval_before_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from new.payment_status
    and (
      not exists (
        select 1 from public.order_delivery_fulfillments fulfillment
        where fulfillment.order_id = new.id
      )
      or not (
        select bool_and(fulfillment.status = 'approved')
        from public.order_delivery_fulfillments fulfillment
        where fulfillment.order_id = new.id
      )
    ) then
    raise exception 'Every rider delivery amount must be approved before payment is accepted.';
  end if;
  return new;
end;
$$;

revoke all on function public.require_delivery_fee_approval_before_payment() from public, anon, authenticated;
drop trigger if exists require_delivery_fee_approval_before_payment on public.orders;
create trigger require_delivery_fee_approval_before_payment
  before update of payment_status on public.orders
  for each row execute function public.require_delivery_fee_approval_before_payment();

create or replace function public.sync_order_delivery_fulfillment_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.status is distinct from old.status then
    update public.order_delivery_fulfillments
    set status = case new.status
        when 'ready' then 'ready'
        when 'cancelled' then 'cancelled'
        else status
      end,
      updated_at = now()
    where order_id = new.id
      and (
        (new.status = 'ready' and status = 'approved')
        or (new.status = 'cancelled' and status <> 'completed')
      );
  end if;
  return new;
end;
$$;

revoke all on function public.sync_order_delivery_fulfillment_status() from public, anon, authenticated;
drop trigger if exists sync_order_delivery_fulfillments on public.orders;
create trigger sync_order_delivery_fulfillments
  after update of status on public.orders
  for each row execute function public.sync_order_delivery_fulfillment_status();

create or replace function public.get_assigned_delivery_fulfillments()
returns table (
  fulfillment_id uuid,
  order_id uuid,
  status public.order_status,
  delivery_address text,
  total numeric,
  assigned_delivery_id uuid,
  buyer_name text,
  buyer_directions text,
  pickup_details text,
  items_summary text,
  updated_at timestamptz,
  market_area text,
  delivery_fee numeric,
  payment_method text,
  payment_status text,
  payment_simulated boolean,
  delivery_date date,
  delivery_slot text,
  fulfillment_status text,
  primary_rider_id uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'delivery'
  ) then
    raise exception 'A delivery partner account is required.';
  end if;

  return query
  select fulfillment.id, order_row.id, order_row.status, order_row.delivery_address,
    order_row.total, fulfillment.rider_id, coalesce(buyer.full_name, ''),
    coalesce(buyer.directions, ''), fulfillment.pickup_details,
    coalesce((
      select string_agg(format('%s %s %s', item.quantity, product.unit, product.name), ' + ' order by product.name)
      from public.order_items item
      join public.products product on product.id = item.product_id
      join public.stores store on store.id = product.store_id
      where item.order_id = order_row.id
        and lower(trim(coalesce(nullif(store.market_area, ''), 'Unspecified market'))) = fulfillment.market_area
    ), 'Order items unavailable'),
    order_row.updated_at, fulfillment.market_area, coalesce(fulfillment.offered_fee, fulfillment.recommended_fee),
    order_row.payment_method, order_row.payment_status, order_row.payment_simulated,
    order_row.delivery_date, order_row.delivery_slot, fulfillment.status,
    order_row.assigned_delivery_id
  from public.order_delivery_fulfillments fulfillment
  join public.orders order_row on order_row.id = fulfillment.order_id
  left join public.profiles buyer on buyer.id = order_row.buyer_id
  where fulfillment.rider_id = auth.uid()
    and (order_row.payment_method <> 'monnify' or order_row.payment_status = 'paid')
    and (
      (order_row.status in ('ready', 'out_for_delivery')
        and fulfillment.status in ('ready', 'out_for_delivery'))
      or (order_row.status = 'completed' and order_row.updated_at >= date_trunc('day', now())
        and fulfillment.status = 'completed')
    )
  order by order_row.updated_at desc;
end;
$$;

alter table public.order_rider_chat_threads
  drop constraint if exists order_rider_chat_threads_order_id_key;
create unique index if not exists order_rider_chat_threads_order_rider_idx
  on public.order_rider_chat_threads(order_id, rider_id);

drop policy if exists "Assigned rider and buyer can view rider chat threads" on public.order_rider_chat_threads;
create policy "Assigned rider and buyer can view rider chat threads"
  on public.order_rider_chat_threads for select to authenticated
  using (
    buyer_id = auth.uid()
    or (
      rider_id = auth.uid()
      and exists (
        select 1 from public.order_delivery_fulfillments fulfillment
        where fulfillment.order_id = order_rider_chat_threads.order_id
          and fulfillment.rider_id = auth.uid()
      )
    )
  );

drop policy if exists "Assigned rider and buyer can view rider chat messages" on public.order_rider_chat_messages;
create policy "Assigned rider and buyer can view rider chat messages"
  on public.order_rider_chat_messages for select to authenticated
  using (
    exists (
      select 1 from public.order_rider_chat_threads thread
      where thread.id = order_rider_chat_messages.thread_id
        and (thread.buyer_id = auth.uid() or thread.rider_id = auth.uid())
    )
  );

create or replace function public.get_or_create_order_rider_chat(
  p_order_id uuid,
  p_rider_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  order_row public.orders%rowtype;
  selected_rider_id uuid;
  chat_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to open order chat.'; end if;
  select * into order_row from public.orders where id = p_order_id;
  if not found or order_row.status = 'cancelled' then
    raise exception 'This order is not available for chat.';
  end if;

  if order_row.buyer_id = auth.uid() then
    selected_rider_id := coalesce(p_rider_id, order_row.assigned_delivery_id);
    if selected_rider_id is null or not exists (
      select 1 from public.order_delivery_fulfillments fulfillment
      where fulfillment.order_id = order_row.id
        and fulfillment.rider_id = selected_rider_id
        and fulfillment.status in ('offered', 'approved', 'ready', 'out_for_delivery', 'completed')
    ) then
      raise exception 'This order has no rider available for chat yet.';
    end if;
  else
    selected_rider_id := auth.uid();
    if p_rider_id is not null and p_rider_id <> selected_rider_id then
      raise exception 'A rider can only open their own order chat.';
    end if;
    if not exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid() and profile.role = 'delivery'
    ) or not exists (
      select 1 from public.order_delivery_fulfillments fulfillment
      where fulfillment.order_id = order_row.id
        and fulfillment.rider_id = auth.uid()
        and fulfillment.status in ('offered', 'approved', 'ready', 'out_for_delivery', 'completed')
    ) then
      raise exception 'Only a rider assigned to this order can open its chat.';
    end if;
  end if;

  insert into public.order_rider_chat_threads (order_id, buyer_id, rider_id)
  values (order_row.id, order_row.buyer_id, selected_rider_id)
  on conflict (order_id, rider_id) do update
    set buyer_id = excluded.buyer_id
  returning id into chat_id;
  return chat_id;
end;
$$;

create or replace function public.get_or_create_order_rider_chat(p_order_id uuid)
returns uuid
language sql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select public.get_or_create_order_rider_chat(p_order_id, null::uuid);
$$;

create or replace function public.send_order_rider_chat_message(p_thread_id uuid, p_message text)
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
    select 1
    from public.order_rider_chat_threads thread
    join public.orders order_row on order_row.id = thread.order_id
    where thread.id = p_thread_id
      and thread.buyer_id = order_row.buyer_id
      and (
        thread.buyer_id = auth.uid()
        or (
          thread.rider_id = auth.uid()
          and exists (
            select 1 from public.order_delivery_fulfillments fulfillment
            where fulfillment.order_id = order_row.id
              and fulfillment.rider_id = auth.uid()
          )
        )
      )
  ) then raise exception 'You are not a participant in this order chat.'; end if;
  insert into public.order_rider_chat_messages (thread_id, sender_id, message)
  values (p_thread_id, auth.uid(), trim(p_message))
  returning id into new_message_id;
  return new_message_id;
end;
$$;

create or replace function public.notify_order_rider_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  thread_row public.order_rider_chat_threads%rowtype;
  recipient_id uuid;
begin
  select * into thread_row from public.order_rider_chat_threads where id = new.thread_id;
  recipient_id := case
    when new.sender_id = thread_row.buyer_id then thread_row.rider_id
    else thread_row.buyer_id
  end;
  insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body, payload)
  values (
    recipient_id, thread_row.order_id, 'new_chat_message',
    'rider-chat:' || new.id::text, 'New order message',
    'You have a new message about order #' || left(thread_row.order_id::text, 6) || '.',
    jsonb_build_object('thread_id', thread_row.id, 'chat_type', 'buyer_rider', 'rider_id', thread_row.rider_id)
  ) on conflict (user_id, event_key) do nothing;
  return new;
end;
$$;

revoke all on function public.get_or_create_order_rider_chat(uuid, uuid) from public, anon;
revoke all on function public.get_or_create_order_rider_chat(uuid) from public, anon;
revoke all on function public.send_order_rider_chat_message(uuid, text) from public, anon;
grant execute on function public.get_or_create_order_rider_chat(uuid, uuid) to authenticated;
grant execute on function public.get_or_create_order_rider_chat(uuid) to authenticated;
grant execute on function public.send_order_rider_chat_message(uuid, text) to authenticated;

create or replace function public.start_delivery_fulfillment(p_fulfillment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  fulfillment public.order_delivery_fulfillments%rowtype;
begin
  select * into fulfillment
  from public.order_delivery_fulfillments
  where id = p_fulfillment_id
    and rider_id = auth.uid()
    and status = 'ready'
  for update;
  if not found or not exists (
    select 1 from public.orders
    where id = fulfillment.order_id
      and status in ('ready', 'out_for_delivery')
      and (payment_method <> 'monnify' or payment_status = 'paid')
  ) then
    raise exception 'This delivery is not ready to start.';
  end if;

  update public.order_delivery_fulfillments
  set status = 'out_for_delivery', updated_at = now()
  where id = p_fulfillment_id;
  update public.orders
  set status = 'out_for_delivery', updated_at = now()
  where id = fulfillment.order_id and status = 'ready';
end;
$$;

create or replace function public.complete_delivery_fulfillment_with_proof(
  p_fulfillment_id uuid,
  p_delivery_proof_path text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  fulfillment public.order_delivery_fulfillments%rowtype;
  all_completed boolean;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'delivery'
  ) then
    raise exception 'A signed-in delivery partner is required.';
  end if;
  select * into fulfillment
  from public.order_delivery_fulfillments
  where id = p_fulfillment_id
    and rider_id = auth.uid()
    and status = 'out_for_delivery'
  for update;
  if not found then
    raise exception 'This assigned delivery is not awaiting completion.';
  end if;
  if p_delivery_proof_path is null
    or (storage.foldername(p_delivery_proof_path))[1] <> fulfillment.order_id::text
    or (storage.foldername(p_delivery_proof_path))[2] <> auth.uid()::text
    or not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'delivery-proofs' and object.name = p_delivery_proof_path
    ) then
    raise exception 'Upload a valid delivery photo before completing this delivery.';
  end if;

  update public.order_delivery_fulfillments
  set status = 'completed', delivery_proof_path = p_delivery_proof_path, updated_at = now()
  where id = p_fulfillment_id;

  select bool_and(status = 'completed') into all_completed
  from public.order_delivery_fulfillments
  where order_id = fulfillment.order_id;
  if all_completed then
    update public.orders
    set status = 'completed', delivery_proof_path = p_delivery_proof_path, updated_at = now()
    where id = fulfillment.order_id and status = 'out_for_delivery';
  end if;
  return all_completed;
end;
$$;

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
    select 1
    from public.profiles profile
    join public.delivery_partners partner on partner.id = profile.id
    join public.rider_verifications verification on verification.rider_id = profile.id
    where profile.id = auth.uid()
      and profile.role = 'delivery'
      and partner.is_available
      and verification.status = 'verified'
  ) then
    raise exception 'A verified, available delivery partner account is required.';
  end if;

  update public.orders
  set assigned_delivery_id = auth.uid(), updated_at = now()
  where id = p_order_id
    and status = 'ready'
    and assigned_delivery_id is null
    and (payment_method <> 'monnify' or payment_status = 'paid')
  returning id into claimed_order_id;
  if claimed_order_id is null then return false; end if;

  update public.order_delivery_fulfillments
  set rider_id = auth.uid(),
      offered_fee = coalesce(offered_fee, recommended_fee),
      status = 'ready',
      updated_at = now()
  where order_id = claimed_order_id and rider_id is null;
  return true;
end;
$$;

create or replace function public.complete_delivery_with_proof(
  p_order_id uuid,
  p_delivery_proof_path text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  order_row public.orders%rowtype;
  affected_rows integer;
  all_completed boolean;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'delivery'
  ) then
    raise exception 'A signed-in delivery partner is required.';
  end if;
  select * into order_row
  from public.orders
  where id = p_order_id
    and assigned_delivery_id = auth.uid()
    and status = 'out_for_delivery'
    and (payment_method <> 'monnify' or payment_status = 'paid')
  for update;
  if not found then
    raise exception 'This assigned order is not awaiting delivery completion.';
  end if;
  if p_delivery_proof_path is null
    or (storage.foldername(p_delivery_proof_path))[1] <> p_order_id::text
    or (storage.foldername(p_delivery_proof_path))[2] <> auth.uid()::text
    or not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'delivery-proofs' and object.name = p_delivery_proof_path
    ) then
    raise exception 'Upload a valid delivery photo before completing this order.';
  end if;

  update public.order_delivery_fulfillments
  set status = 'completed', delivery_proof_path = p_delivery_proof_path, updated_at = now()
  where order_id = p_order_id
    and rider_id = auth.uid()
    and status = 'out_for_delivery';
  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    raise exception 'This rider has no active pickup location on this order.';
  end if;

  select bool_and(status = 'completed') into all_completed
  from public.order_delivery_fulfillments
  where order_id = p_order_id;
  if all_completed then
    update public.orders
    set status = 'completed', delivery_proof_path = p_delivery_proof_path, updated_at = now()
    where id = p_order_id;
  end if;
end;
$$;

create or replace function public.prevent_partial_order_completion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status
    and exists (
      select 1 from public.order_delivery_fulfillments fulfillment
      where fulfillment.order_id = new.id
    )
    and not (
      select bool_and(fulfillment.status = 'completed')
      from public.order_delivery_fulfillments fulfillment
      where fulfillment.order_id = new.id
    ) then
    raise exception 'Every pickup location must be delivered before the order can be completed.';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_partial_order_completion() from public, anon, authenticated;
drop trigger if exists prevent_partial_order_completion on public.orders;
create trigger prevent_partial_order_completion
  before update of status on public.orders
  for each row execute function public.prevent_partial_order_completion();

create or replace function public.record_fulfillment_rider_payout()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  all_fulfillments_completed boolean;
begin
  if new.status = 'completed' and old.status is distinct from new.status
    then
    select bool_and(status = 'completed') into all_fulfillments_completed
    from public.order_delivery_fulfillments
    where order_id = new.order_id;
    if all_fulfillments_completed and not exists (
      select 1 from public.orders where id = new.order_id and payment_simulated
    ) then
      insert into public.marketplace_payouts (order_id, beneficiary_id, payout_type, amount)
      select order_id, rider_id, 'rider', sum(offered_fee)
      from public.order_delivery_fulfillments
      where order_id = new.order_id
        and rider_id is not null
        and offered_fee is not null
      group by order_id, rider_id
      having sum(offered_fee) > 0
      on conflict (order_id, beneficiary_id, payout_type) do nothing;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.record_fulfillment_rider_payout() from public, anon, authenticated;
drop trigger if exists record_fulfillment_rider_payout on public.order_delivery_fulfillments;
create trigger record_fulfillment_rider_payout
  after update of status on public.order_delivery_fulfillments
  for each row execute function public.record_fulfillment_rider_payout();

revoke all on function public.get_buyer_delivery_fulfillments(uuid[]) from public, anon;
revoke all on function public.get_available_delivery_fee_offers() from public, anon;
revoke all on function public.submit_delivery_fee_offer(uuid, numeric) from public, anon;
revoke all on function public.approve_order_delivery_fees(uuid) from public, anon;
revoke all on function public.get_assigned_delivery_fulfillments() from public, anon;
revoke all on function public.start_delivery_fulfillment(uuid) from public, anon;
revoke all on function public.complete_delivery_fulfillment_with_proof(uuid, text) from public, anon;
grant execute on function public.get_buyer_delivery_fulfillments(uuid[]) to authenticated;
grant execute on function public.get_available_delivery_fee_offers() to authenticated;
grant execute on function public.submit_delivery_fee_offer(uuid, numeric) to authenticated;
grant execute on function public.approve_order_delivery_fees(uuid) to authenticated;
grant execute on function public.get_assigned_delivery_fulfillments() to authenticated;
grant execute on function public.start_delivery_fulfillment(uuid) to authenticated;
grant execute on function public.complete_delivery_fulfillment_with_proof(uuid, text) to authenticated;

notify pgrst, 'reload schema';

do $$
begin
  alter publication supabase_realtime add table public.order_delivery_fulfillments;
exception
  when duplicate_object then null;
end;
$$;

commit;
