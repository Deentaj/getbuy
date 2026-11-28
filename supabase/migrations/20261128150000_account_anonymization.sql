begin;

alter table public.profiles
  drop constraint if exists profiles_id_fkey,
  add column if not exists deleted_at timestamptz;

create table if not exists public.deleted_account_keys (
  user_id_hash text primary key check (user_id_hash ~ '^[0-9a-f]{64}$'),
  deleted_at timestamptz not null default now()
);

alter table public.deleted_account_keys enable row level security;
revoke all on public.deleted_account_keys from public, anon, authenticated;
grant all on public.deleted_account_keys to service_role;

create or replace function public.prevent_deleted_profile_recreation()
returns trigger
language plpgsql
security definer
set search_path = extensions, public, pg_temp
set row_security = off
as $$
begin
  if new.deleted_at is null and not exists (
    select 1 from auth.users where id = new.id
  ) then
    raise exception 'An active profile must belong to an authentication account.' using errcode = '23503';
  end if;
  if new.deleted_at is not null and auth.role() is distinct from 'service_role' then
    raise exception 'Only the account deletion service can create a deleted profile.' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.deleted_account_keys
    where user_id_hash = encode(digest(new.id::text, 'sha256'), 'hex')
  ) then
    raise exception 'This account has been deleted.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists block_deleted_profile_recreation on public.profiles;
create trigger block_deleted_profile_recreation
  before insert on public.profiles
  for each row execute function public.prevent_deleted_profile_recreation();

revoke all on function public.prevent_deleted_profile_recreation() from public, anon, authenticated;

create or replace function public.anonymize_account_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = extensions, public, pg_temp
set row_security = off
as $$
declare
  original_profile public.profiles%rowtype;
  tombstone_id uuid := gen_random_uuid();
  seller_store_ids uuid[];
  profile_reference record;
begin
  if p_user_id is null then
    raise exception 'ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.deleted_account_keys
    where user_id_hash = encode(digest(p_user_id::text, 'sha256'), 'hex')
  ) then
    return;
  end if;

  select * into original_profile
  from public.profiles
  where id = p_user_id
  for update;
  if not found then
    raise exception 'ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if original_profile.role = 'admin'
    or exists (
      select 1 from public.admin_staff_memberships
      where user_id = p_user_id
    ) then
    raise exception 'ACCOUNT_DELETION_ADMIN_RESTRICTED' using errcode = '42501';
  end if;

  insert into public.deleted_account_keys (user_id_hash)
  values (encode(digest(p_user_id::text, 'sha256'), 'hex'));

  insert into public.profiles (
    id, full_name, avatar_path, role, phone_number, location,
    area, directions, created_at, updated_at, deleted_at
  )
  values (
    tombstone_id, 'Deleted account', null, original_profile.role, '',
    null, '', '', original_profile.created_at, now(), now()
  );

  perform 1
  from public.stores
  where owner_id = p_user_id
  for update;

  select coalesce(array_agg(id), array[]::uuid[])
  into seller_store_ids
  from public.stores
  where owner_id = p_user_id;

  update public.stores
  set owner_id = tombstone_id
  where id = any(seller_store_ids);

  update public.products
  set is_available = false
  where store_id = any(seller_store_ids);

  if exists (
    select 1
    from public.orders order_row
    where order_row.status not in ('completed', 'cancelled')
      and (
        order_row.buyer_id = p_user_id
        or order_row.assigned_delivery_id = p_user_id
        or exists (
          select 1
          from public.order_items item
          join public.products product on product.id = item.product_id
          where item.order_id = order_row.id
            and product.store_id = any(seller_store_ids)
        )
      )
    union all
    select 1
    from public.order_delivery_fulfillments fulfillment
    where fulfillment.rider_id = p_user_id
      and fulfillment.status not in ('completed', 'cancelled')
  ) then
    raise exception 'ACCOUNT_DELETION_BLOCKED_ACTIVE_ORDERS' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.marketplace_payouts
    where beneficiary_id = p_user_id and status = 'due'
    union all
    select 1 from public.monnify_order_splits
    where beneficiary_id = p_user_id and status = 'pending'
    union all
    select 1 from public.cod_remittances
    where rider_id = p_user_id and status <> 'confirmed'
    union all
    select 1 from public.order_refunds
    where buyer_id = p_user_id and status in ('pending_manual', 'processing')
  ) then
    raise exception 'ACCOUNT_DELETION_BLOCKED_UNSETTLED_FUNDS' using errcode = 'P0001';
  end if;

  update public.stores
  set name = 'Deleted seller store',
      market_area = '',
      pickup_details = '',
      description = ''
  where id = any(seller_store_ids);

  update public.products
  set description = null,
      image_url = null,
      is_available = false,
      updated_at = now()
  where store_id = any(seller_store_ids);

  update public.store_promos
  set active = false
  where store_id = any(seller_store_ids);

  delete from public.store_verifications
  where store_id = any(seller_store_ids);
  delete from public.store_monnify_subaccounts
  where store_id = any(seller_store_ids);
  delete from public.rider_verifications where rider_id = p_user_id;
  delete from public.nin_verifications where user_id = p_user_id;
  delete from public.payout_accounts where user_id = p_user_id;
  delete from public.user_notifications where user_id = p_user_id;
  delete from public.notification_push_tokens where user_id = p_user_id;
  delete from public.web_push_subscriptions where user_id = p_user_id;
  delete from public.marketplace_alerts where user_id = p_user_id;
  delete from public.product_stock_alerts where buyer_id = p_user_id;
  delete from public.product_favorites where buyer_id = p_user_id;
  delete from public.cart_items where buyer_id = p_user_id;
  delete from public.buyer_loyalty_transactions where user_id = p_user_id;
  delete from public.buyer_referral_codes where user_id = p_user_id;
  delete from public.buyer_referrals
  where referred_user_id = p_user_id or referrer_id = p_user_id;
  update public.buyer_loyalty_transactions
  set transaction_key = replace(transaction_key, p_user_id::text, tombstone_id::text)
  where user_id <> p_user_id
    and position(p_user_id::text in transaction_key) > 0;
  delete from public.delivery_order_locations where rider_id = p_user_id;
  delete from public.order_chat_threads
  where buyer_id = p_user_id or seller_id = p_user_id;
  delete from public.order_rider_chat_threads
  where buyer_id = p_user_id or rider_id = p_user_id;

  update public.orders
  set delivery_address = 'Address removed at account deletion'
  where buyer_id = p_user_id;
  update public.order_cancellation_requests
  set reason = 'Details removed at account deletion.',
      admin_note = ''
  where buyer_id = p_user_id;
  update public.order_refunds
  set admin_note = ''
  where buyer_id = p_user_id;
  update public.order_issues
  set description = 'Details removed at account deletion.',
      admin_note = ''
  where buyer_id = p_user_id;
  update public.store_reviews
  set review = ''
  where buyer_id = p_user_id
    or store_id = any(seller_store_ids);
  update public.rider_reviews
  set review = ''
  where buyer_id = p_user_id or rider_id = p_user_id;

  update public.orders
  set assigned_delivery_id = tombstone_id
  where assigned_delivery_id = p_user_id;
  update public.order_delivery_fulfillments
  set rider_id = tombstone_id
  where rider_id = p_user_id;

  for profile_reference in
    select
      relation_namespace.nspname as schema_name,
      relation_class.relname as table_name,
      local_attribute.attname as column_name,
      local_attribute.attnotnull as is_not_null
    from pg_constraint foreign_key
    join pg_class relation_class on relation_class.oid = foreign_key.conrelid
    join pg_namespace relation_namespace on relation_namespace.oid = relation_class.relnamespace
    cross join lateral unnest(foreign_key.conkey) with ordinality as local_key(attnum, key_position)
    join lateral unnest(foreign_key.confkey) with ordinality as referenced_key(attnum, key_position)
      on referenced_key.key_position = local_key.key_position
    join pg_attribute local_attribute
      on local_attribute.attrelid = foreign_key.conrelid
      and local_attribute.attnum = local_key.attnum
    join pg_attribute referenced_attribute
      on referenced_attribute.attrelid = foreign_key.confrelid
      and referenced_attribute.attnum = referenced_key.attnum
    where foreign_key.contype = 'f'
      and foreign_key.confrelid = 'public.profiles'::regclass
      and referenced_attribute.attname = 'id'
      and relation_namespace.nspname = 'public'
    order by relation_class.relname, local_attribute.attname
  loop
    if (profile_reference.table_name = 'orders'
        and profile_reference.column_name = 'assigned_delivery_id')
      or (profile_reference.table_name = 'order_delivery_fulfillments'
        and profile_reference.column_name = 'rider_id') then
      continue;
    end if;

    if profile_reference.is_not_null then
      execute format(
        'update %I.%I set %I = $2 where %I = $1',
        profile_reference.schema_name,
        profile_reference.table_name,
        profile_reference.column_name,
        profile_reference.column_name
      ) using p_user_id, tombstone_id;
    else
      execute format(
        'update %I.%I set %I = null where %I = $1',
        profile_reference.schema_name,
        profile_reference.table_name,
        profile_reference.column_name,
        profile_reference.column_name
      ) using p_user_id;
    end if;
  end loop;

  delete from public.delivery_partners where id = tombstone_id;
  update public.profiles
  set full_name = 'Deleted account',
      avatar_path = null,
      phone_number = '',
      location = null,
      area = '',
      directions = '',
      updated_at = now(),
      deleted_at = now()
  where id = tombstone_id;

  delete from public.profiles where id = p_user_id;
end;
$$;

revoke all on function public.anonymize_account_data(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_account_data(uuid) to service_role;

commit;
