begin;

create table if not exists public.admin_staff_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin', 'customer_service', 'account_manager', 'finance')),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_staff_memberships enable row level security;
revoke all on public.admin_staff_memberships from public, anon, authenticated;

insert into public.admin_staff_memberships (user_id, role, granted_by)
select profile.id, 'super_admin', profile.id
from public.profiles profile
where profile.role = 'admin'
on conflict (user_id) do update
set role = 'super_admin',
    granted_by = excluded.granted_by,
    updated_at = now();

create or replace function public.get_admin_staff_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select case
    when public.is_admin() then 'super_admin'
    else (
      select membership.role
      from public.admin_staff_memberships membership
      where membership.user_id = auth.uid()
    )
  end;
$$;

create or replace function public.admin_has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select public.is_admin() or exists (
    select 1
    from public.admin_staff_memberships membership
    where membership.user_id = auth.uid()
      and (
        membership.role = 'super_admin'
        or (p_permission = 'support' and membership.role = 'customer_service')
        or (p_permission = 'accounts' and membership.role = 'account_manager')
        or (p_permission = 'finance' and membership.role = 'finance')
      )
  );
$$;

revoke all on function public.get_admin_staff_role() from public, anon;
revoke all on function public.admin_has_permission(text) from public, anon;
grant execute on function public.get_admin_staff_role() to authenticated;
grant execute on function public.admin_has_permission(text) to authenticated;

create or replace function public.get_admin_staff_directory()
returns table (user_id uuid, email text, role text, created_at timestamptz)
language plpgsql
security definer
set search_path = public, auth, pg_temp
set row_security = off
as $$
begin
  if not public.is_admin() then
    raise exception 'Super administrator access is required.';
  end if;

  return query
  select membership.user_id, coalesce(account.email, '')::text,
         membership.role, membership.created_at
  from public.admin_staff_memberships membership
  join auth.users account on account.id = membership.user_id
  order by case membership.role
    when 'super_admin' then 0
    when 'customer_service' then 1
    when 'account_manager' then 2
    else 3
  end, lower(account.email);
end;
$$;

revoke all on function public.get_admin_staff_directory() from public, anon;
grant execute on function public.get_admin_staff_directory() to authenticated;

create or replace function public.get_admin_accounts_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  snapshot jsonb;
begin
  if not public.admin_has_permission('accounts') then
    raise exception 'Account management access is required.';
  end if;

  select jsonb_build_object(
    'metrics', jsonb_build_object(
      'buyers', (select count(*) from public.profiles where role = 'buyer'),
      'stores', (select count(*) from public.stores),
      'pending_verification', (select count(*) from public.store_verifications where status = 'pending'),
      'pending_rider_verification', (select count(*) from public.rider_verifications where status = 'pending'),
      'live_orders', 0,
      'available_riders', (
        select count(*)
        from public.delivery_partners partner
        join public.rider_verifications verification
          on verification.rider_id = partner.id and verification.status = 'verified'
        where partner.is_available
      )
    ),
    'orders', '[]'::jsonb,
    'stores', coalesce((
      select jsonb_agg(to_jsonb(recent_stores) order by recent_stores.created_at desc)
      from (
        select store.id, store.name, store.category, store.market_area, store.owner_id, store.created_at,
               coalesce(owner.full_name, 'Store owner') as owner_name,
               count(product.id)::integer as product_count,
               coalesce(verification.status, 'unverified') as verification_status
        from public.stores store
        left join public.profiles owner on owner.id = store.owner_id
        left join public.products product on product.store_id = store.id
        left join public.store_verifications verification on verification.store_id = store.id
        group by store.id, owner.full_name, verification.status
        order by store.created_at desc
        limit 100
      ) recent_stores
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(to_jsonb(recent_products) order by recent_products.created_at desc)
      from (
        select product.id, product.name, product.category, product.price, product.unit,
               product.stock_quantity, product.is_available, product.created_at,
               store.name as store_name, store.id as store_id
        from public.products product
        join public.stores store on store.id = product.store_id
        order by product.created_at desc
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
        select partner.id, coalesce(profile.full_name, 'Delivery partner') as full_name,
               partner.vehicle_type, partner.is_available, partner.created_at,
               coalesce(verification.status, 'unverified') as verification_status,
               verification.plate_number
        from public.delivery_partners partner
        left join public.profiles profile on profile.id = partner.id
        left join public.rider_verifications verification on verification.rider_id = partner.id
        order by partner.created_at desc
        limit 100
      ) recent_riders
    ), '[]'::jsonb)
  ) into snapshot;

  return snapshot;
end;
$$;

revoke all on function public.get_admin_accounts_snapshot() from public, anon;
grant execute on function public.get_admin_accounts_snapshot() to authenticated;

create or replace function public.get_admin_support_buyer_names(p_buyer_ids uuid[])
returns table (id uuid, full_name text)
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if not (
    public.is_admin()
    or public.admin_has_permission('support')
    or public.admin_has_permission('finance')
  ) then
    raise exception 'Support or finance access is required.';
  end if;

  return query
  select profile.id, profile.full_name
  from public.profiles profile
  where profile.id = any(coalesce(p_buyer_ids, '{}'::uuid[]))
    and (
      public.is_admin()
      or (
        public.admin_has_permission('support')
        and (
          exists (select 1 from public.order_issues issue where issue.buyer_id = profile.id)
          or exists (select 1 from public.order_cancellation_requests request where request.buyer_id = profile.id)
        )
      )
      or (
        public.admin_has_permission('finance')
        and exists (select 1 from public.order_refunds refund where refund.buyer_id = profile.id)
      )
    );
end;
$$;

revoke all on function public.get_admin_support_buyer_names(uuid[]) from public, anon;
grant execute on function public.get_admin_support_buyer_names(uuid[]) to authenticated;

drop policy if exists "Customer service can view order issues" on public.order_issues;
create policy "Customer service can view order issues"
  on public.order_issues for select to authenticated
  using (public.admin_has_permission('support'));

drop policy if exists "Customer service can view cancellation requests" on public.order_cancellation_requests;
create policy "Customer service can view cancellation requests"
  on public.order_cancellation_requests for select to authenticated
  using (public.admin_has_permission('support'));

drop policy if exists "Finance staff can view order refunds" on public.order_refunds;
create policy "Finance staff can view order refunds"
  on public.order_refunds for select to authenticated
  using (public.admin_has_permission('finance'));

drop policy if exists "Account managers can view verification documents" on storage.objects;
create policy "Account managers can view verification documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'verification-documents'
    and public.admin_has_permission('accounts')
  );

create or replace function public.get_store_verification_queue()
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
  if not public.admin_has_permission('accounts') then
    raise exception 'Account management access is required.';
  end if;

  return query
  select store.id, store.name, store.category, store.market_area, store.pickup_details, store.description,
         profile.full_name, coalesce(account.email, '')::text, verification.requested_at,
         verification.storefront_photo_path, verification.seller_id_path
  from public.store_verifications verification
  join public.stores store on store.id = verification.store_id
  join public.profiles profile on profile.id = store.owner_id
  join auth.users account on account.id = store.owner_id
  where verification.status = 'pending'
  order by verification.requested_at asc;
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
  if not public.admin_has_permission('accounts') then
    raise exception 'Account management access is required.';
  end if;
  if p_approved and not exists (
    select 1
    from public.store_verifications verification
    join storage.objects storefront
      on storefront.bucket_id = 'verification-documents'
      and storefront.name = verification.storefront_photo_path
    join storage.objects seller_id
      on seller_id.bucket_id = 'verification-documents'
      and seller_id.name = verification.seller_id_path
    where verification.store_id = p_store_id and verification.status = 'pending'
  ) then
    raise exception 'Both required store verification photos must be available before approval.';
  end if;

  next_status := case when p_approved then 'verified' else 'rejected' end;
  update public.store_verifications
  set status = next_status, reviewed_at = now(), reviewed_by = auth.uid()
  where store_id = p_store_id and status = 'pending';
  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    raise exception 'This verification request is no longer pending.';
  end if;
  return next_status;
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
  if not public.admin_has_permission('accounts') then
    raise exception 'Account management access is required.';
  end if;

  return query
  select verification.id, verification.rider_id, profile.full_name,
         coalesce(account.email, '')::text, verification.plate_number,
         verification.plate_photo_path, verification.roadworthiness_photo_path,
         verification.driver_license_photo_path, verification.requested_at
  from public.rider_verifications verification
  join public.profiles profile on profile.id = verification.rider_id
  join auth.users account on account.id = verification.rider_id
  where verification.status = 'pending'
  order by verification.requested_at asc;
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
  if not public.admin_has_permission('accounts') then
    raise exception 'Account management access is required.';
  end if;
  if p_approved and not exists (
    select 1
    from public.rider_verifications verification
    join storage.objects plate
      on plate.bucket_id = 'verification-documents' and plate.name = verification.plate_photo_path
    join storage.objects roadworthiness
      on roadworthiness.bucket_id = 'verification-documents' and roadworthiness.name = verification.roadworthiness_photo_path
    join storage.objects driver_license
      on driver_license.bucket_id = 'verification-documents' and driver_license.name = verification.driver_license_photo_path
    where verification.id = p_verification_id and verification.status = 'pending'
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

create or replace function public.admin_set_product_availability(
  p_product_id uuid,
  p_is_available boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  affected_rows integer;
begin
  if not public.admin_has_permission('accounts') then
    raise exception 'Account management access is required.';
  end if;
  if p_is_available and not exists (
    select 1 from public.products product
    where product.id = p_product_id
      and (product.stock_quantity > 0 or exists (
        select 1 from jsonb_array_elements(product.variant_options) as variant_entry(value)
        where coalesce((variant_entry.value ->> 'stock')::numeric, 0) > 0
      ))
  ) then
    raise exception 'Products need available stock before they can be listed.';
  end if;
  update public.products
  set is_available = p_is_available, updated_at = now()
  where id = p_product_id;
  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    raise exception 'Product not found.';
  end if;
end;
$$;

create or replace function public.update_order_issue(
  p_issue_id uuid,
  p_status text,
  p_admin_note text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  issue_row public.order_issues%rowtype;
begin
  if auth.uid() is null or not public.admin_has_permission('support') then
    raise exception 'Customer service access is required.';
  end if;
  if p_status not in ('open', 'in_review', 'resolved')
    or char_length(coalesce(p_admin_note, '')) > 1000 then
    raise exception 'Choose a valid issue status and an admin note under 1000 characters.';
  end if;
  update public.order_issues
  set status = p_status, admin_note = trim(coalesce(p_admin_note, '')), updated_at = now()
  where id = p_issue_id
  returning * into issue_row;
  if not found then
    raise exception 'This issue report no longer exists.';
  end if;

  insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body)
  values (
    issue_row.buyer_id,
    issue_row.order_id,
    'support_update',
    'support_update:' || issue_row.id::text || ':' || to_char(issue_row.updated_at, 'YYYYMMDDHH24MISSUS'),
    'Support case updated',
    'GetBuy support updated your report for order #' || left(issue_row.order_id::text, 6) ||
      ' to ' || replace(issue_row.status, '_', ' ') ||
      case when nullif(trim(issue_row.admin_note), '') is null then '.'
        else ': ' || trim(issue_row.admin_note) end
  );
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
  if not public.admin_has_permission('support') then
    raise exception 'Customer service access is required.';
  end if;
  select * into request_row from public.order_cancellation_requests where id = p_request_id for update;
  if not found or request_row.status <> 'pending' then
    raise exception 'This cancellation request is no longer pending.';
  end if;
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
    perform public.restore_order_inventory(order_row.id);
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
  if not public.admin_has_permission('finance') then
    raise exception 'Finance access is required.';
  end if;
  if p_status not in ('processing', 'refunded', 'rejected') then
    raise exception 'Choose a valid refund status.';
  end if;
  if p_status = 'refunded' and nullif(trim(coalesce(p_provider_reference, '')), '') is null then
    raise exception 'Enter the completed refund transfer reference.';
  end if;

  update public.order_refunds
  set status = p_status,
      provider_reference = nullif(left(trim(coalesce(p_provider_reference, '')), 120), ''),
      admin_note = left(trim(coalesce(p_admin_note, '')), 1000),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_refund_id and status in ('pending_manual', 'processing');
  if not found then
    raise exception 'This refund is no longer awaiting review.';
  end if;

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

create or replace function public.admin_save_cod_collection_account(
  p_bank_name text,
  p_account_name text,
  p_account_number text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  normalized_number text := regexp_replace(coalesce(p_account_number, ''), '\s', '', 'g');
begin
  if not public.admin_has_permission('finance') then
    raise exception 'Finance access is required.';
  end if;
  if nullif(trim(p_bank_name), '') is null or length(trim(p_bank_name)) > 100 then
    raise exception 'Enter a valid bank name.';
  end if;
  if nullif(trim(p_account_name), '') is null or length(trim(p_account_name)) > 120 then
    raise exception 'Enter the account holder name.';
  end if;
  if normalized_number !~ '^[0-9]{10}$' then
    raise exception 'Enter a valid 10-digit Nigerian bank account number.';
  end if;

  insert into public.marketplace_collection_account (id, bank_name, account_name, account_number, updated_at)
  values (true, trim(p_bank_name), trim(p_account_name), normalized_number, now())
  on conflict (id) do update
  set bank_name = excluded.bank_name,
      account_name = excluded.account_name,
      account_number = excluded.account_number,
      updated_at = now();
end;
$$;

create or replace function public.admin_review_cod_remittance(p_remittance_id uuid, p_approved boolean)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  affected_rows integer;
begin
  if not public.admin_has_permission('finance') then
    raise exception 'Finance access is required.';
  end if;
  update public.cod_remittances
  set status = case when p_approved then 'confirmed' else 'rejected' end,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = p_remittance_id and status = 'pending';
  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    raise exception 'This remittance is no longer awaiting review.';
  end if;
  return case when p_approved then 'confirmed' else 'rejected' end;
end;
$$;

create or replace function public.admin_mark_payout_paid(p_payout_id uuid, p_transfer_reference text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  affected_rows integer;
begin
  if not public.admin_has_permission('finance') then
    raise exception 'Finance access is required.';
  end if;
  if nullif(trim(p_transfer_reference), '') is null or length(trim(p_transfer_reference)) > 120 then
    raise exception 'Enter the completed bank transfer reference.';
  end if;

  update public.marketplace_payouts payout
  set status = 'paid',
      transfer_reference = trim(p_transfer_reference),
      paid_at = now(),
      paid_by = auth.uid()
  from public.orders order_row
  where payout.order_id = order_row.id
    and payout.id = p_payout_id
    and payout.status = 'due'
    and order_row.buyer_confirmed_at is not null
    and (
      (order_row.payment_method = 'monnify' and order_row.payment_status = 'paid')
      or (
        order_row.payment_method = 'cash_on_delivery'
        and exists (
          select 1 from public.cod_remittances remittance
          where remittance.order_id = payout.order_id and remittance.status = 'confirmed'
        )
      )
    )
    and exists (
      select 1 from public.payout_accounts account
      where account.user_id = payout.beneficiary_id
    );
  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    raise exception 'Payout is blocked until the buyer confirms receipt, payment or COD remittance is verified, and the recipient has valid bank details.';
  end if;
end;
$$;

create or replace function public.get_admin_finance_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
set row_security = off
as $$
declare
  result jsonb;
begin
  if not public.admin_has_permission('finance') then
    raise exception 'Finance access is required.';
  end if;

  select jsonb_build_object(
    'collection_account', (
      select jsonb_build_object('bank_name', account.bank_name, 'account_name', account.account_name, 'account_number', account.account_number)
      from public.marketplace_collection_account account where account.id = true
    ),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', payout.id,
        'order_id', payout.order_id,
        'beneficiary_id', payout.beneficiary_id,
        'payout_type', payout.payout_type,
        'amount', payout.amount,
        'status', payout.status,
        'transfer_reference', payout.transfer_reference,
        'created_at', payout.created_at,
        'beneficiary_name', profile.full_name,
        'beneficiary_email', account_user.email,
        'bank_name', account.bank_name,
        'account_name', account.account_name,
        'account_number', account.account_number,
        'store_names', case when payout.payout_type = 'seller' then coalesce((
          select string_agg(distinct store.name, ', ' order by store.name)
          from public.order_items order_item
          join public.products product on product.id = order_item.product_id
          join public.stores store on store.id = product.store_id
          where order_item.order_id = payout.order_id and store.owner_id = payout.beneficiary_id
        ), '') else '' end,
        'remittance_status', case
          when order_row.buyer_confirmed_at is null then 'waiting_for_buyer'
          when order_row.payment_method = 'monnify' and order_row.payment_status = 'paid' then 'payment_verified'
          else coalesce(remittance.status, 'not_submitted')
        end
      ) order by payout.created_at desc)
      from public.marketplace_payouts payout
      join public.orders order_row on order_row.id = payout.order_id
      join public.profiles profile on profile.id = payout.beneficiary_id
      join auth.users account_user on account_user.id = payout.beneficiary_id
      left join public.payout_accounts account on account.user_id = payout.beneficiary_id
      left join public.cod_remittances remittance on remittance.order_id = payout.order_id
      where payout.status = 'due'
    ), '[]'::jsonb),
    'remittances', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', remittance.id,
        'order_id', remittance.order_id,
        'rider_id', remittance.rider_id,
        'rider_name', profile.full_name,
        'rider_email', account_user.email,
        'expected_amount', remittance.expected_amount,
        'transfer_reference', remittance.transfer_reference,
        'status', remittance.status,
        'submitted_at', remittance.submitted_at
      ) order by remittance.submitted_at)
      from public.cod_remittances remittance
      join public.profiles profile on profile.id = remittance.rider_id
      join auth.users account_user on account_user.id = remittance.rider_id
      where remittance.status = 'pending'
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.get_admin_revenue_report(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.admin_has_permission('finance') then
    raise exception 'Finance access is required.';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Choose a valid report period of no more than 367 days.';
  end if;

  with collected as (
    select order_row.id as order_id, order_row.created_at as occurred_at,
           order_row.total as amount, order_row.payment_method
    from public.orders order_row
    where order_row.created_at >= (p_from::timestamp at time zone 'Africa/Lagos')
      and order_row.created_at < ((p_to + 1)::timestamp at time zone 'Africa/Lagos')
      and not order_row.payment_simulated
      and (
        (order_row.payment_method = 'monnify' and order_row.payment_status = 'paid')
        or (
          order_row.payment_method = 'cash_on_delivery'
          and exists (
            select 1 from public.cod_remittances remittance
            where remittance.order_id = order_row.id and remittance.status = 'confirmed'
          )
        )
      )
  ),
  paid_refunds as (
    select refund.id, refund.order_id,
           coalesce(refund.reviewed_at, refund.created_at) as occurred_at,
           refund.amount, refund.status
    from public.order_refunds refund
    where refund.created_at < ((p_to + 1)::timestamp at time zone 'Africa/Lagos')
      and coalesce(refund.reviewed_at, refund.created_at) >= (p_from::timestamp at time zone 'Africa/Lagos')
  ),
  payout_rows as (
    select payout.id::text as id, payout.order_id,
           coalesce(payout.paid_at, payout.created_at) as occurred_at,
           payout.amount, payout.status, payout.payout_type,
           'marketplace_payout'::text as source
    from public.marketplace_payouts payout
    where coalesce(payout.paid_at, payout.created_at) >= (p_from::timestamp at time zone 'Africa/Lagos')
      and coalesce(payout.paid_at, payout.created_at) < ((p_to + 1)::timestamp at time zone 'Africa/Lagos')
    union all
    select split.id::text, split.order_id, coalesce(split.paid_at, split.created_at),
           split.amount, split.status, 'seller'::text, 'monnify_split'::text
    from public.monnify_order_splits split
    where split.status = 'paid'
      and coalesce(split.paid_at, split.created_at) >= (p_from::timestamp at time zone 'Africa/Lagos')
      and coalesce(split.paid_at, split.created_at) < ((p_to + 1)::timestamp at time zone 'Africa/Lagos')
  ),
  totals as (
    select
      coalesce((select sum(amount) from collected), 0) as gross_collected,
      (select count(*) from collected) as collected_orders,
      coalesce((select sum(amount) from paid_refunds where status = 'refunded'), 0) as refunds_paid,
      coalesce((select sum(amount) from paid_refunds where status in ('pending_manual', 'processing')), 0) as refunds_pending,
      coalesce((select sum(amount) from payout_rows where status = 'paid' and payout_type = 'seller'), 0) as seller_paid,
      coalesce((select sum(amount) from payout_rows where status = 'paid' and payout_type = 'rider'), 0) as rider_paid,
      coalesce((select sum(amount) from payout_rows where status = 'due'), 0) as payouts_due
  ),
  transactions as (
    select collected.occurred_at, 'collection'::text as type, collected.order_id,
           collected.amount, 'verified'::text as status, collected.payment_method as description
    from collected
    union all
    select refund.occurred_at, 'refund', refund.order_id, -refund.amount, refund.status, 'Buyer refund'
    from paid_refunds refund
    union all
    select payout_rows.occurred_at,
           case when payout_rows.payout_type = 'seller' then 'seller_payout' else 'rider_payout' end,
           payout_rows.order_id, -payout_rows.amount, payout_rows.status, payout_rows.source
    from payout_rows
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'summary', jsonb_build_object(
      'gross_collected', totals.gross_collected,
      'collected_orders', totals.collected_orders,
      'refunds_paid', totals.refunds_paid,
      'refunds_pending', totals.refunds_pending,
      'net_after_refunds', totals.gross_collected - totals.refunds_paid,
      'seller_paid', totals.seller_paid,
      'rider_paid', totals.rider_paid,
      'payouts_due', totals.payouts_due
    ),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', transaction.occurred_at,
        'type', transaction.type,
        'order_id', transaction.order_id,
        'amount', transaction.amount,
        'status', transaction.status,
        'description', transaction.description
      ) order by transaction.occurred_at desc)
      from transactions transaction
    ), '[]'::jsonb)
  ) into result
  from totals;

  return result;
end;
$$;

create or replace function public.audit_admin_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  old_row jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  new_row jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  entity_id_value text;
  details_value jsonb := '{}'::jsonb;
begin
  if auth.uid() is null or public.get_admin_staff_role() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and old_row = new_row then
    return new;
  end if;

  entity_id_value := coalesce(
    new_row ->> 'id', old_row ->> 'id',
    new_row ->> 'store_id', old_row ->> 'store_id',
    new_row ->> 'order_id', old_row ->> 'order_id'
  );
  details_value := case tg_table_name
    when 'orders' then jsonb_build_object(
      'status', coalesce(new_row ->> 'status', old_row ->> 'status'),
      'payment_status', coalesce(new_row ->> 'payment_status', old_row ->> 'payment_status')
    )
    when 'order_issues' then jsonb_build_object(
      'status', coalesce(new_row ->> 'status', old_row ->> 'status'),
      'issue_type', coalesce(new_row ->> 'issue_type', old_row ->> 'issue_type')
    )
    when 'order_cancellation_requests' then jsonb_build_object(
      'status', coalesce(new_row ->> 'status', old_row ->> 'status')
    )
    when 'order_refunds' then jsonb_build_object(
      'status', coalesce(new_row ->> 'status', old_row ->> 'status'),
      'amount', coalesce(new_row ->> 'amount', old_row ->> 'amount')
    )
    when 'marketplace_payouts' then jsonb_build_object(
      'status', coalesce(new_row ->> 'status', old_row ->> 'status'),
      'payout_type', coalesce(new_row ->> 'payout_type', old_row ->> 'payout_type'),
      'amount', coalesce(new_row ->> 'amount', old_row ->> 'amount')
    )
    when 'cod_remittances' then jsonb_build_object(
      'status', coalesce(new_row ->> 'status', old_row ->> 'status'),
      'expected_amount', coalesce(new_row ->> 'expected_amount', old_row ->> 'expected_amount')
    )
    when 'monnify_order_splits' then jsonb_build_object(
      'status', coalesce(new_row ->> 'status', old_row ->> 'status'),
      'amount', coalesce(new_row ->> 'amount', old_row ->> 'amount')
    )
    when 'store_verifications' then jsonb_build_object(
      'status', coalesce(new_row ->> 'status', old_row ->> 'status')
    )
    when 'rider_verifications' then jsonb_build_object(
      'status', coalesce(new_row ->> 'status', old_row ->> 'status')
    )
    when 'products' then jsonb_build_object(
      'is_available', coalesce(new_row -> 'is_available', old_row -> 'is_available')
    )
    when 'store_monnify_subaccounts' then jsonb_build_object(
      'subaccount_configured', tg_op <> 'DELETE'
    )
    when 'marketplace_collection_account' then jsonb_build_object(
      'account_configured', tg_op <> 'DELETE'
    )
    else '{}'::jsonb
  end;

  insert into public.admin_activity_log(actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(entity_id_value, 'unknown'),
    details_value
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

commit;
