begin;

alter table public.orders
  add column if not exists delivery_date date,
  add column if not exists loyalty_discount numeric(10, 2) not null default 0 check (loyalty_discount >= 0),
  add column if not exists loyalty_points_redeemed integer not null default 0 check (loyalty_points_redeemed >= 0),
  add column if not exists delivered_at timestamptz;

update public.orders
set delivery_date = (coalesce(created_at, now()) at time zone 'Africa/Lagos')::date
where delivery_date is null;
alter table public.orders
  alter column delivery_date set default ((now() at time zone 'Africa/Lagos')::date),
  alter column delivery_date set not null;

update public.orders
set delivered_at = updated_at
where status = 'completed' and delivered_at is null;

create table if not exists public.order_cancellation_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (char_length(reason) between 5 and 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note text not null default '',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists order_cancellation_one_pending_idx
  on public.order_cancellation_requests(order_id) where status = 'pending';
create index if not exists order_cancellation_status_created_idx
  on public.order_cancellation_requests(status, created_at desc);

create table if not exists public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  amount numeric(10, 2) not null check (amount > 0),
  status text not null default 'pending_manual'
    check (status in ('pending_manual', 'processing', 'refunded', 'rejected')),
  provider_reference text,
  admin_note text not null default '',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.order_cancellation_requests enable row level security;
alter table public.order_refunds enable row level security;
revoke all on public.order_cancellation_requests, public.order_refunds from anon, authenticated;
grant select on public.order_cancellation_requests, public.order_refunds to authenticated;

drop policy if exists "Buyers and admins view cancellation requests" on public.order_cancellation_requests;
create policy "Buyers and admins view cancellation requests"
  on public.order_cancellation_requests for select to authenticated
  using (buyer_id = auth.uid() or public.is_admin());
drop policy if exists "Buyers and admins view order refunds" on public.order_refunds;
create policy "Buyers and admins view order refunds"
  on public.order_refunds for select to authenticated
  using (buyer_id = auth.uid() or public.is_admin());

create table if not exists public.buyer_loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid references public.orders(id) on delete restrict,
  points_delta integer not null check (points_delta <> 0),
  reason text not null check (reason in ('order_reward', 'order_redemption', 'redemption_reversal', 'referral_reward')),
  transaction_key text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists buyer_loyalty_transactions_user_created_idx
  on public.buyer_loyalty_transactions(user_id, created_at desc);
alter table public.buyer_loyalty_transactions enable row level security;
revoke all on public.buyer_loyalty_transactions from anon, authenticated;
grant select on public.buyer_loyalty_transactions to authenticated;
drop policy if exists "Buyers view their loyalty history" on public.buyer_loyalty_transactions;
create policy "Buyers view their loyalty history"
  on public.buyer_loyalty_transactions for select to authenticated
  using (user_id = auth.uid());

create table if not exists public.buyer_referral_codes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);
create table if not exists public.buyer_referrals (
  referred_user_id uuid primary key references public.profiles(id) on delete cascade,
  referrer_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (referred_user_id <> referrer_id)
);
alter table public.buyer_referral_codes enable row level security;
alter table public.buyer_referrals enable row level security;
revoke all on public.buyer_referral_codes, public.buyer_referrals from anon, authenticated;
grant select on public.buyer_loyalty_transactions, public.buyer_referral_codes, public.buyer_referrals to authenticated;
drop policy if exists "Users view their own referral code" on public.buyer_referral_codes;
create policy "Users view their own referral code"
  on public.buyer_referral_codes for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users view referrals they sent" on public.buyer_referrals;
create policy "Users view referrals they sent"
  on public.buyer_referrals for select to authenticated using (referrer_id = auth.uid());

create or replace function public.get_my_loyalty_summary()
returns table (points_balance bigint, points_earned bigint, referral_code text, successful_referrals bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to view your rewards.'; end if;
  return query
  select
    coalesce(sum(transaction.points_delta), 0)::bigint,
    coalesce(sum(transaction.points_delta) filter (where transaction.points_delta > 0), 0)::bigint,
    code.code,
    (select count(*) from public.buyer_referrals referral
      where referral.referrer_id = auth.uid()
        and exists (
          select 1 from public.buyer_loyalty_transactions reward
          where reward.user_id = referral.referrer_id
            and reward.reason = 'referral_reward'
            and reward.transaction_key like 'referral:' || referral.referred_user_id::text || ':%:referrer'
        ))::bigint
  from public.buyer_loyalty_transactions transaction
  left join public.buyer_referral_codes code on code.user_id = auth.uid()
  where transaction.user_id = auth.uid()
  group by code.code;
  if not found then
    return query select 0::bigint, 0::bigint, code.code, 0::bigint
      from public.buyer_referral_codes code where code.user_id = auth.uid();
    if not found then return query select 0::bigint, 0::bigint, null::text, 0::bigint; end if;
  end if;
end;
$$;

create or replace function public.get_or_create_my_referral_code()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  referral_code text;
  attempts integer := 0;
begin
  if auth.uid() is null then raise exception 'Sign in to get your referral link.'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'buyer') then
    raise exception 'Buyer accounts are required for referral codes.';
  end if;
  select code into referral_code
    from public.buyer_referral_codes where user_id = auth.uid();
  if found then return referral_code; end if;

  loop
    attempts := attempts + 1;
    if attempts > 5 then
      raise exception 'Unable to create a unique referral code. Please try again.';
    end if;
    referral_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    begin
      insert into public.buyer_referral_codes (user_id, code)
      values (auth.uid(), referral_code);
      return referral_code;
    exception when unique_violation then
      select code into referral_code
        from public.buyer_referral_codes where user_id = auth.uid();
      if found then return referral_code; end if;
    end;
  end loop;
end;
$$;

create or replace function public.apply_buyer_referral_code(p_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  referrer uuid;
  existing_referrer uuid;
begin
  if auth.uid() is null then raise exception 'Sign in before using a referral code.'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'buyer') then
    raise exception 'Buyer accounts are required for referral codes.';
  end if;
  perform 1 from public.profiles where id = auth.uid() for update;
  select user_id into referrer from public.buyer_referral_codes
    where code = upper(trim(coalesce(p_code, '')));
  if referrer is null then raise exception 'That referral code is not valid.'; end if;
  if referrer = auth.uid() then raise exception 'You cannot use your own referral code.'; end if;
  select referrer_id into existing_referrer
    from public.buyer_referrals where referred_user_id = auth.uid();
  if found then
    if existing_referrer = referrer then return; end if;
    raise exception 'A different referral code has already been applied to this account.';
  end if;
  if exists (select 1 from public.orders where buyer_id = auth.uid()) then
    raise exception 'Referral codes can only be applied before your first order.';
  end if;
  insert into public.buyer_referrals (referred_user_id, referrer_id)
  values (auth.uid(), referrer);
end;
$$;

create or replace function public.get_seller_inventory_analytics()
returns table (
  product_id uuid,
  units_sold_30d bigint,
  sales_30d numeric,
  last_sold_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'seller'
  ) then raise exception 'A seller account is required.'; end if;
  return query
  select product.id,
    coalesce(sum(item.quantity) filter (
      where order_row.status = 'completed'
        and order_row.delivered_at >= now() - interval '30 days'
    ), 0)::bigint,
    coalesce(sum(item.quantity * item.unit_price) filter (
      where order_row.status = 'completed'
        and order_row.delivered_at >= now() - interval '30 days'
    ), 0)::numeric,
    max(order_row.delivered_at) filter (where order_row.status = 'completed')
  from public.stores store
  join public.products product on product.store_id = store.id
  left join public.order_items item on item.product_id = product.id
  left join public.orders order_row on order_row.id = item.order_id
  where store.owner_id = auth.uid()
  group by product.id;
end;
$$;

create or replace function public.bulk_update_store_stock(p_product_ids uuid[], p_quantities integer[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  updated_count integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'seller'
  ) then raise exception 'A seller account is required.'; end if;
  if p_product_ids is null or p_quantities is null
    or cardinality(p_product_ids) = 0
    or cardinality(p_product_ids) <> cardinality(p_quantities)
    or cardinality(p_product_ids) > 200
    or exists (select 1 from unnest(p_quantities) quantity where quantity < 0) then
    raise exception 'Choose up to 200 products and enter valid stock counts.'; end if;
  if exists (
    select 1 from unnest(p_product_ids) product_id
    group by product_id having count(*) > 1
  ) then raise exception 'A product can only be updated once per batch.'; end if;
  update public.products product
  set stock_quantity = input.quantity,
      is_available = input.quantity > 0,
      updated_at = now()
  from unnest(p_product_ids, p_quantities) as input(product_id, quantity)
  join public.stores store on store.owner_id = auth.uid()
  where product.id = input.product_id and product.store_id = store.id;
  get diagnostics updated_count = row_count;
  if updated_count <> cardinality(p_product_ids) then
    raise exception 'One or more products are not in your store. No stock changes were saved.';
  end if;
end;
$$;

create or replace function public.get_my_delivery_history()
returns table (
  order_id uuid,
  status text,
  delivered_at timestamptz,
  delivery_date date,
  delivery_slot text,
  total numeric,
  payment_method text,
  remittance_status text,
  rider_payout numeric,
  buyer_confirmed_at timestamptz
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
  ) then raise exception 'A delivery partner account is required.'; end if;
  return query
  select order_row.id, order_row.status::text, order_row.delivered_at,
    order_row.delivery_date, order_row.delivery_slot, order_row.total,
    order_row.payment_method, coalesce(remittance.status, 'not_required'),
    coalesce(payout.amount, 0), order_row.buyer_confirmed_at
  from public.orders order_row
  left join public.cod_remittances remittance on remittance.order_id = order_row.id
  left join public.marketplace_payouts payout
    on payout.order_id = order_row.id and payout.beneficiary_id = auth.uid() and payout.payout_type = 'rider'
  where order_row.assigned_delivery_id = auth.uid()
    and (order_row.status = 'completed' or order_row.status = 'cancelled')
  order by coalesce(order_row.delivered_at, order_row.updated_at) desc
  limit 100;
end;
$$;

alter table public.user_notifications
  alter column order_id drop not null,
  add column if not exists payload jsonb not null default '{}'::jsonb;
alter table public.user_notifications drop constraint if exists user_notifications_event_type_check;
alter table public.user_notifications add constraint user_notifications_event_type_check
  check (event_type in (
    'new_order', 'order_ready', 'new_chat_message', 'product_back_in_stock',
    'product_low_stock', 'loyalty_reward', 'referral_reward', 'order_cancelled',
    'cancellation_update', 'refund_update'
  ));
grant all on public.user_notifications to service_role;

create or replace function public.notify_sellers_of_new_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body)
  select distinct store.owner_id, order_row.id, 'new_order',
    'new_order:' || order_row.id::text, 'New order received',
    'A buyer placed order #' || left(order_row.id::text, 6) || '. Review it in your seller dashboard.'
  from inserted_order_items inserted_item
  join public.orders order_row on order_row.id = inserted_item.order_id
  join public.order_items item on item.order_id = order_row.id
  join public.products product on product.id = item.product_id
  join public.stores store on store.id = product.store_id
  where order_row.status = 'pending'
    and (order_row.payment_method <> 'monnify' or order_row.payment_status = 'paid')
  on conflict (user_id, event_key) do nothing;
  return null;
end;
$$;

create or replace function public.notify_sellers_after_monnify_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.status = 'pending'
    and new.payment_method = 'monnify'
    and new.payment_status = 'paid'
    and old.payment_status is distinct from new.payment_status then
    insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body)
    select distinct store.owner_id, new.id, 'new_order',
      'new_order:' || new.id::text, 'New order received',
      'A buyer placed order #' || left(new.id::text, 6) || '. Review it in your seller dashboard.'
    from public.order_items item
    join public.products product on product.id = item.product_id
    join public.stores store on store.id = product.store_id
    where item.order_id = new.id
    on conflict (user_id, event_key) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists notify_sellers_after_monnify_payment on public.orders;
create trigger notify_sellers_after_monnify_payment after update of payment_status on public.orders
  for each row execute function public.notify_sellers_after_monnify_payment();

create or replace function public.notify_order_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  thread_row public.order_chat_threads%rowtype;
  recipient_id uuid;
begin
  select * into thread_row from public.order_chat_threads where id = new.thread_id;
  recipient_id := case when new.sender_id = thread_row.buyer_id then thread_row.seller_id else thread_row.buyer_id end;
  insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body, payload)
  values (
    recipient_id, thread_row.order_id, 'new_chat_message',
    'chat:' || new.id::text, 'New order message',
    'You have a new message about order #' || left(thread_row.order_id::text, 6) || '.',
    jsonb_build_object('thread_id', thread_row.id, 'store_id', thread_row.store_id)
  ) on conflict (user_id, event_key) do nothing;
  return new;
end;
$$;
drop trigger if exists notify_order_chat_message on public.order_chat_messages;
create trigger notify_order_chat_message after insert on public.order_chat_messages
  for each row execute function public.notify_order_chat_message();

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
    insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body, payload)
    select alert.buyer_id, null, 'product_back_in_stock',
      'back_in_stock:' || new.id::text || ':' || alert.buyer_id::text || ':' || now()::date::text,
      'Back in stock', new.name || ' is available again at ' || store.name || '.',
      jsonb_build_object('product_id', new.id)
    from public.product_stock_alerts alert
    join public.stores store on store.id = new.store_id
    where alert.product_id = new.id
    on conflict (user_id, event_key) do nothing;
    update public.product_stock_alerts
      set notified_at = now() where product_id = new.id and notified_at is null;
  end if;
  if new.stock_quantity > 0 and new.stock_quantity <= 5 and new.is_available
    and (old.stock_quantity > 5 or old.stock_quantity <= 0 or old.is_available is false) then
    insert into public.marketplace_alerts (user_id, product_id, alert_type, message)
    select store.owner_id, new.id, 'low_stock',
      new.name || ' is low on stock (' || new.stock_quantity || ' left).'
    from public.stores store where store.id = new.store_id;
    insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body, payload)
    select store.owner_id, null, 'product_low_stock',
      'low_stock:' || new.id::text || ':' || new.stock_quantity::text,
      'Low stock alert', new.name || ' has only ' || new.stock_quantity || ' units left.',
      jsonb_build_object('product_id', new.id)
    from public.stores store where store.id = new.store_id
    on conflict (user_id, event_key) do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.set_order_delivered_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status and new.delivered_at is null then
    new.delivered_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists set_order_delivered_at on public.orders;
create trigger set_order_delivered_at before update of status on public.orders
  for each row execute function public.set_order_delivered_at();

create or replace function public.create_marketplace_order_with_options(
  p_delivery_address text,
  p_payment_method text,
  p_product_ids uuid[],
  p_delivery_slot text,
  p_promo_code text,
  p_delivery_date date,
  p_loyalty_points integer
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
  eligible_subtotal numeric(10, 2);
  discount numeric(10, 2) := 0;
  requested_points integer := coalesce(p_loyalty_points, 0);
  user_points bigint;
  local_hour integer;
begin
  if auth.uid() is null then raise exception 'Sign in before placing an order.'; end if;
  perform 1 from public.profiles where id = auth.uid() for update;
  if p_delivery_slot not in ('morning', 'afternoon', 'evening') then
    raise exception 'Choose a valid delivery time window.';
  end if;
  if p_delivery_date is null or p_delivery_date < (now() at time zone 'Africa/Lagos')::date
    or p_delivery_date > (now() at time zone 'Africa/Lagos')::date + 14 then
    raise exception 'Choose a delivery date within the next 14 days.';
  end if;
  local_hour := extract(hour from (now() at time zone 'Africa/Lagos'));
  if p_delivery_date = (now() at time zone 'Africa/Lagos')::date
    and ((p_delivery_slot = 'morning' and local_hour >= 12)
      or (p_delivery_slot = 'afternoon' and local_hour >= 16)
      or (p_delivery_slot = 'evening' and local_hour >= 20)) then
    raise exception 'That delivery window has passed. Choose a later window or another date.';
  end if;
  if requested_points < 0 then raise exception 'Rewards points cannot be negative.'; end if;

  if requested_points > 0 then
    select coalesce(sum(points_delta), 0) into user_points
      from public.buyer_loyalty_transactions where user_id = auth.uid();
    if requested_points > user_points then raise exception 'You do not have enough rewards points.'; end if;
  end if;

  new_order_id := public.create_marketplace_order(p_delivery_address, p_payment_method, p_product_ids);
  if nullif(trim(coalesce(p_promo_code, '')), '') is not null then
    select * into promo_row from public.store_promos
      where code = upper(trim(p_promo_code)) and active for update;
    if not found then raise exception 'This promo code is invalid or inactive.'; end if;
    if exists (select 1 from public.store_promo_redemptions where promo_id = promo_row.id and buyer_id = auth.uid()) then
      raise exception 'You have already used this promo code.'; end if;
    select coalesce(sum(item.quantity * item.unit_price), 0) into seller_subtotal
      from public.order_items item
      join public.products product on product.id = item.product_id
      where item.order_id = new_order_id and product.store_id = promo_row.store_id;
    if seller_subtotal <= 0 then raise exception 'Your cart has no products from this store.'; end if;
    discount := round(seller_subtotal * promo_row.percent_off / 100.0, 2);
    update public.orders set promo_id = promo_row.id, promo_store_id = promo_row.store_id,
      promo_code = promo_row.code, promo_discount = discount, total = total - discount
      where id = new_order_id;
    insert into public.store_promo_redemptions(promo_id, buyer_id, order_id)
      values (promo_row.id, auth.uid(), new_order_id);
  end if;

  select coalesce(sum(item.quantity * item.unit_price), 0) into eligible_subtotal
    from public.order_items item where item.order_id = new_order_id;
  update public.orders set delivery_slot = p_delivery_slot, delivery_date = p_delivery_date
    where id = new_order_id;
  if requested_points > 0 then
    discount := least(requested_points, floor(eligible_subtotal * 0.1), user_points);
    if discount > 0 then
      update public.orders set loyalty_discount = discount,
        loyalty_points_redeemed = discount::integer, total = total - discount
        where id = new_order_id;
      insert into public.buyer_loyalty_transactions(user_id, order_id, points_delta, reason, transaction_key)
      values (auth.uid(), new_order_id, -discount::integer, 'order_redemption', 'redeem:' || new_order_id::text);
    end if;
  end if;
  return new_order_id;
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
language sql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select public.create_marketplace_order_with_options(
    p_delivery_address, p_payment_method, p_product_ids, p_delivery_slot, p_promo_code,
    (now() at time zone 'Africa/Lagos')::date, 0
  );
$$;

create or replace function public.award_loyalty_and_referrals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  earned_points integer;
  referrer uuid;
begin
  if new.buyer_confirmed_at is not null
    and new.status = 'completed'
    and not new.payment_simulated
    and (
      (new.payment_method = 'monnify' and new.payment_status = 'paid')
      or (
        new.payment_method = 'cash_on_delivery'
        and exists (
          select 1 from public.cod_remittances remittance
          where remittance.order_id = new.id and remittance.status = 'confirmed'
        )
      )
    ) then
    select greatest(0, floor((coalesce(sum(item.quantity * item.unit_price), 0)
      - new.promo_discount) / 100.0))::integer
    into earned_points
    from public.order_items item where item.order_id = new.id;
    if earned_points > 0 then
      insert into public.buyer_loyalty_transactions(user_id, order_id, points_delta, reason, transaction_key)
      values (new.buyer_id, new.id, earned_points, 'order_reward', 'order_reward:' || new.id::text)
      on conflict (transaction_key) do nothing;
      insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body, payload)
      values (new.buyer_id, new.id, 'loyalty_reward', 'loyalty:' || new.id::text,
        'Rewards added', earned_points || ' GetBuy points were added to your balance.',
        jsonb_build_object('points', earned_points))
      on conflict (user_id, event_key) do nothing;
    end if;
    select referral.referrer_id into referrer from public.buyer_referrals referral
      where referral.referred_user_id = new.buyer_id;
    if referrer is not null and not exists (
      select 1 from public.buyer_loyalty_transactions
      where user_id = new.buyer_id and reason = 'referral_reward'
        and transaction_key like 'referral:%:referred'
    ) then
      insert into public.buyer_loyalty_transactions(user_id, order_id, points_delta, reason, transaction_key)
      values
        (new.buyer_id, new.id, 500, 'referral_reward', 'referral:' || new.buyer_id::text || ':' || new.id::text || ':referred'),
        (referrer, new.id, 500, 'referral_reward', 'referral:' || new.buyer_id::text || ':' || new.id::text || ':referrer')
      on conflict (transaction_key) do nothing;
      insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body, payload)
      values
        (new.buyer_id, new.id, 'referral_reward', 'referral:' || new.id::text || ':buyer',
          'Referral reward unlocked', 'You earned 500 points for your first confirmed order.',
          jsonb_build_object('points', 500)),
        (referrer, new.id, 'referral_reward', 'referral:' || new.id::text || ':referrer',
          'A friend ordered', 'You earned 500 points after your friend’s first confirmed order.',
          jsonb_build_object('points', 500))
      on conflict (user_id, event_key) do nothing;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists award_loyalty_and_referrals on public.orders;
create trigger award_loyalty_and_referrals after update of buyer_confirmed_at on public.orders
  for each row execute function public.award_loyalty_and_referrals();

create or replace function public.retry_order_rewards_after_cod_remittance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.status = 'confirmed' and old.status is distinct from new.status then
    update public.orders
      set buyer_confirmed_at = buyer_confirmed_at
      where id = new.order_id
        and status = 'completed'
        and buyer_confirmed_at is not null;
  end if;
  return new;
end;
$$;
drop trigger if exists retry_order_rewards_after_cod_remittance on public.cod_remittances;
create trigger retry_order_rewards_after_cod_remittance after update of status on public.cod_remittances
  for each row execute function public.retry_order_rewards_after_cod_remittance();

create or replace function public.notify_admin_cancellation_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.status = 'pending' then
    insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body, payload)
    select profile.id, new.order_id, 'cancellation_update',
      'cancellation_review:' || new.id::text || ':' || profile.id::text,
      'Cancellation request needs review',
      'A buyer requested cancellation for order #' || left(new.order_id::text, 6) || '.',
      jsonb_build_object('cancellation_request_id', new.id)
    from public.profiles profile where profile.role = 'admin'
    on conflict (user_id, event_key) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists notify_admin_cancellation_request on public.order_cancellation_requests;
create trigger notify_admin_cancellation_request after insert on public.order_cancellation_requests
  for each row execute function public.notify_admin_cancellation_request();

create or replace function public.notify_admin_manual_refund()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body, payload)
  select profile.id, new.order_id, 'refund_update',
    'refund_review:' || new.id::text || ':' || profile.id::text,
    'Manual refund needs review',
    'A manual refund for order #' || left(new.order_id::text, 6) || ' needs review.',
    jsonb_build_object('refund_id', new.id, 'amount', new.amount)
  from public.profiles profile where profile.role = 'admin'
  on conflict (user_id, event_key) do nothing;
  return new;
end;
$$;
drop trigger if exists notify_admin_manual_refund on public.order_refunds;
create trigger notify_admin_manual_refund after insert on public.order_refunds
  for each row execute function public.notify_admin_manual_refund();

create or replace function public.notify_sellers_order_cancelled()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from new.status then
    insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body)
    select distinct store.owner_id, new.id, 'order_cancelled',
      'order_cancelled:seller:' || new.id::text || ':' || store.owner_id::text,
      'Order cancelled',
      'Order #' || left(new.id::text, 6) || ' was cancelled. Reserved stock has been restored.'
    from public.order_items item
    join public.products product on product.id = item.product_id
    join public.stores store on store.id = product.store_id
    where item.order_id = new.id
    on conflict (user_id, event_key) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists notify_sellers_order_cancelled on public.orders;
create trigger notify_sellers_order_cancelled after update of status on public.orders
  for each row execute function public.notify_sellers_order_cancelled();

create or replace function public.admin_record_monnify_payment(
  p_order_id uuid,
  p_payment_reference text,
  p_amount_paid numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  order_row public.orders%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Payment verification service access is required.';
  end if;
  select * into order_row
  from public.orders
  where id = p_order_id
  for update;
  if not found or order_row.payment_method <> 'monnify'
    or order_row.payment_reference <> p_payment_reference then
    raise exception 'The payment does not match a GetBuy order.';
  end if;
  if abs(coalesce(p_amount_paid, 0) - order_row.total) > 0.01 then
    raise exception 'The verified Monnify amount does not match the order total.';
  end if;
  if order_row.payment_status = 'paid' then
    return;
  end if;
  if order_row.payment_status <> 'pending' then
    raise exception 'This order is not awaiting payment.';
  end if;
  update public.orders
  set payment_status = 'paid', updated_at = now()
  where id = p_order_id;
  if order_row.status = 'cancelled' then
    insert into public.order_refunds(order_id, buyer_id, amount)
    values (order_row.id, order_row.buyer_id, order_row.total)
    on conflict (order_id) do nothing;
    insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body)
    values (order_row.buyer_id, order_row.id, 'refund_update',
      'late_payment_refund:' || order_row.id::text, 'Refund required',
      'Monnify completed payment after this order was cancelled. A manual refund is pending review.')
    on conflict (user_id, event_key) do nothing;
  end if;
end;
$$;

create or replace function public.request_order_cancellation(p_order_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  order_row public.orders%rowtype;
  request_id uuid;
begin
  if auth.uid() is null or char_length(trim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'Enter a cancellation reason between 5 and 1000 characters.';
  end if;
  select * into order_row from public.orders where id = p_order_id and buyer_id = auth.uid() for update;
  if not found then raise exception 'This order is not associated with your account.'; end if;
  if order_row.status not in ('pending', 'accepted', 'preparing') then
    raise exception 'Cancellation is unavailable after the order is ready or delivery has begun.';
  end if;
  insert into public.order_cancellation_requests(order_id, buyer_id, reason, status, admin_note, reviewed_at)
  values (order_row.id, auth.uid(), trim(p_reason),
    case when order_row.status = 'pending' then 'approved' else 'pending' end,
    case when order_row.status = 'pending' then 'Automatically cancelled before seller acceptance.' else '' end,
    case when order_row.status = 'pending' then now() else null end)
  returning id into request_id;

  if order_row.status = 'pending' then
    update public.products product
      set stock_quantity = product.stock_quantity + items.quantity,
        is_available = true, updated_at = now()
      from (
        select product_id, sum(quantity)::integer as quantity
        from public.order_items
        where order_id = order_row.id
        group by product_id
      ) items
      where items.product_id = product.id;
    update public.orders set status = 'cancelled', updated_at = now() where id = order_row.id;
    if order_row.payment_method = 'monnify' and order_row.payment_status = 'paid' and not order_row.payment_simulated then
      insert into public.order_refunds(order_id, buyer_id, amount)
      values (order_row.id, order_row.buyer_id, order_row.total)
      on conflict (order_id) do nothing;
    end if;
    if order_row.loyalty_points_redeemed > 0 then
      insert into public.buyer_loyalty_transactions(user_id, order_id, points_delta, reason, transaction_key)
      values (order_row.buyer_id, order_row.id, order_row.loyalty_points_redeemed,
        'redemption_reversal', 'redemption_reversal:' || order_row.id::text)
      on conflict (transaction_key) do nothing;
    end if;
    insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body)
      values (order_row.buyer_id, order_row.id, 'order_cancelled', 'cancelled:' || order_row.id::text,
        'Order cancelled', 'Your order was cancelled. Any eligible online refund is pending manual review.')
      on conflict (user_id, event_key) do nothing;
  end if;
  return request_id;
end;
$$;

create or replace function public.admin_review_order_cancellation(
  p_request_id uuid, p_approve boolean, p_admin_note text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  request_row public.order_cancellation_requests%rowtype;
  order_row public.orders%rowtype;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Administrator access is required.';
  end if;
  select * into request_row from public.order_cancellation_requests where id = p_request_id for update;
  if not found or request_row.status <> 'pending' then raise exception 'This cancellation request is no longer pending.'; end if;
  select * into order_row from public.orders where id = request_row.order_id for update;
  if p_approve and order_row.status not in ('accepted', 'preparing') then
    raise exception 'This order has advanced too far for cancellation.';
  end if;
  update public.order_cancellation_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
      admin_note = left(trim(coalesce(p_admin_note, '')), 1000),
      reviewed_by = auth.uid(), reviewed_at = now()
    where id = request_row.id;
  if p_approve then
    update public.products product
      set stock_quantity = product.stock_quantity + items.quantity,
        is_available = true, updated_at = now()
      from (
        select product_id, sum(quantity)::integer as quantity
        from public.order_items
        where order_id = order_row.id
        group by product_id
      ) items
      where items.product_id = product.id;
    update public.orders set status = 'cancelled', updated_at = now() where id = order_row.id;
    if order_row.payment_method = 'monnify' and order_row.payment_status = 'paid' and not order_row.payment_simulated then
      insert into public.order_refunds(order_id, buyer_id, amount)
      values (order_row.id, order_row.buyer_id, order_row.total)
      on conflict (order_id) do nothing;
    end if;
    if order_row.loyalty_points_redeemed > 0 then
      insert into public.buyer_loyalty_transactions(user_id, order_id, points_delta, reason, transaction_key)
      values (order_row.buyer_id, order_row.id, order_row.loyalty_points_redeemed,
        'redemption_reversal', 'redemption_reversal:' || order_row.id::text)
      on conflict (transaction_key) do nothing;
    end if;
  end if;
  insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body)
  values (request_row.buyer_id, request_row.order_id, 'cancellation_update',
    'cancellation_update:' || request_row.id::text,
    case when p_approve then 'Cancellation approved' else 'Cancellation not approved' end,
    coalesce(nullif(trim(p_admin_note), ''), case when p_approve then 'Your order was cancelled.' else 'Your order will continue as planned.' end))
  on conflict (user_id, event_key) do nothing;
end;
$$;

create or replace function public.admin_update_order_refund(
  p_refund_id uuid, p_status text, p_provider_reference text, p_admin_note text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  refund_row public.order_refunds%rowtype;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Administrator access is required.';
  end if;
  if p_status not in ('processing', 'refunded', 'rejected') then
    raise exception 'Choose a valid refund status.';
  end if;
  if p_status = 'refunded' and nullif(trim(coalesce(p_provider_reference, '')), '') is null then
    raise exception 'Enter the completed refund transfer reference.';
  end if;
  update public.order_refunds set status = p_status,
    provider_reference = nullif(left(trim(coalesce(p_provider_reference, '')), 120), ''),
    admin_note = left(trim(coalesce(p_admin_note, '')), 1000),
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_refund_id and status in ('pending_manual', 'processing');
  if not found then raise exception 'This refund is no longer awaiting review.'; end if;
  select * into refund_row from public.order_refunds where id = p_refund_id;
  insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body)
  values (refund_row.buyer_id, refund_row.order_id, 'refund_update',
    'refund_update:' || refund_row.id::text || ':' || p_status,
    case p_status when 'refunded' then 'Refund recorded' when 'processing' then 'Refund processing' else 'Refund not approved' end,
    coalesce(nullif(trim(p_admin_note), ''),
      case p_status when 'refunded' then 'A refund of ₦' || refund_row.amount::text || ' has been recorded.'
        when 'processing' then 'Your refund is being processed manually.'
        else 'Your refund request was not approved.' end))
  on conflict (user_id, event_key) do nothing;
end;
$$;

revoke all on function public.get_my_loyalty_summary() from public, anon;
revoke all on function public.get_or_create_my_referral_code() from public, anon;
revoke all on function public.apply_buyer_referral_code(text) from public, anon;
revoke all on function public.get_seller_inventory_analytics() from public, anon;
revoke all on function public.bulk_update_store_stock(uuid[], integer[]) from public, anon;
revoke all on function public.get_my_delivery_history() from public, anon;
revoke all on function public.request_order_cancellation(uuid, text) from public, anon;
revoke all on function public.admin_review_order_cancellation(uuid, boolean, text) from public, anon;
revoke all on function public.admin_update_order_refund(uuid, text, text, text) from public, anon;
revoke all on function public.notify_sellers_of_new_order() from public, anon, authenticated;
revoke all on function public.notify_order_chat_message() from public, anon, authenticated;
revoke all on function public.notify_product_stock_changes() from public, anon, authenticated;
revoke all on function public.set_order_delivered_at() from public, anon, authenticated;
revoke all on function public.award_loyalty_and_referrals() from public, anon, authenticated;
revoke all on function public.notify_sellers_after_monnify_payment() from public, anon, authenticated;
revoke all on function public.retry_order_rewards_after_cod_remittance() from public, anon, authenticated;
revoke all on function public.notify_admin_cancellation_request() from public, anon, authenticated;
revoke all on function public.notify_admin_manual_refund() from public, anon, authenticated;
revoke all on function public.notify_sellers_order_cancelled() from public, anon, authenticated;
revoke all on function public.create_marketplace_order_with_options(text, text, uuid[], text, text, date, integer) from public, anon;
revoke all on function public.create_marketplace_order_with_options(text, text, uuid[], text, text) from public, anon;
grant execute on function public.get_my_loyalty_summary() to authenticated;
grant execute on function public.get_or_create_my_referral_code() to authenticated;
grant execute on function public.apply_buyer_referral_code(text) to authenticated;
grant execute on function public.get_seller_inventory_analytics() to authenticated;
grant execute on function public.bulk_update_store_stock(uuid[], integer[]) to authenticated;
grant execute on function public.get_my_delivery_history() to authenticated;
grant execute on function public.request_order_cancellation(uuid, text) to authenticated;
grant execute on function public.admin_review_order_cancellation(uuid, boolean, text) to authenticated;
grant execute on function public.admin_update_order_refund(uuid, text, text, text) to authenticated;
grant execute on function public.create_marketplace_order_with_options(text, text, uuid[], text, text, date, integer) to authenticated;
grant execute on function public.create_marketplace_order_with_options(text, text, uuid[], text, text) to authenticated;

commit;
