begin;

create table if not exists public.admin_activity_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_activity_log_created_at_idx
  on public.admin_activity_log(created_at desc);
create index if not exists admin_activity_log_entity_idx
  on public.admin_activity_log(entity_type, entity_id, created_at desc);

alter table public.admin_activity_log enable row level security;
revoke all on public.admin_activity_log from public, anon, authenticated;
grant select on public.admin_activity_log to authenticated;
drop policy if exists "Admins can view activity log" on public.admin_activity_log;
create policy "Admins can view activity log"
  on public.admin_activity_log for select to authenticated
  using (public.is_admin());

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
  if auth.uid() is null or not public.is_admin() then
    if tg_op = 'DELETE' then
      return old;
    end if;
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
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_admin_activity() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'orders',
    'order_issues',
    'order_cancellation_requests',
    'order_refunds',
    'marketplace_payouts',
    'cod_remittances',
    'monnify_order_splits',
    'store_verifications',
    'rider_verifications',
    'products',
    'store_monnify_subaccounts',
    'marketplace_collection_account'
  ] loop
    execute format('drop trigger if exists audit_admin_activity on public.%I', table_name);
    execute format(
      'create trigger audit_admin_activity after insert or update or delete on public.%I for each row execute function public.audit_admin_activity()',
      table_name
    );
  end loop;
end;
$$;

create or replace function public.get_admin_activity_log(p_limit integer default 100)
returns table (
  id bigint,
  actor_id uuid,
  actor_name text,
  action text,
  entity_type text,
  entity_id text,
  details jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required.';
  end if;
  return query
    select log.id, log.actor_id, coalesce(profile.full_name, 'Administrator'),
      log.action, log.entity_type, log.entity_id, log.details, log.created_at
    from public.admin_activity_log log
    left join public.profiles profile on profile.id = log.actor_id
    order by log.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 200));
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
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required.';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Choose a valid report period of no more than 367 days.';
  end if;

  with collected as (
    select o.id as order_id, o.created_at as occurred_at, o.total as amount, o.payment_method
    from public.orders o
    where o.created_at >= (p_from::timestamp at time zone 'Africa/Lagos')
      and o.created_at < ((p_to + 1)::timestamp at time zone 'Africa/Lagos')
      and not o.payment_simulated
      and (
        (o.payment_method = 'monnify' and o.payment_status = 'paid')
        or (
          o.payment_method = 'cash_on_delivery'
          and exists (
            select 1 from public.cod_remittances remittance
            where remittance.order_id = o.id and remittance.status = 'confirmed'
          )
        )
      )
  ),
  paid_refunds as (
    select refund.id, refund.order_id, coalesce(refund.reviewed_at, refund.created_at) as occurred_at,
      refund.amount, refund.status
    from public.order_refunds refund
    where refund.created_at < ((p_to + 1)::timestamp at time zone 'Africa/Lagos')
      and coalesce(refund.reviewed_at, refund.created_at) >= (p_from::timestamp at time zone 'Africa/Lagos')
  ),
  payout_rows as (
    select payout.id::text as id, payout.order_id, coalesce(payout.paid_at, payout.created_at) as occurred_at,
      payout.amount, payout.status, payout.payout_type, 'marketplace_payout'::text as source
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
        'date', tx.occurred_at,
        'type', tx.type,
        'order_id', tx.order_id,
        'amount', tx.amount,
        'status', tx.status,
        'description', tx.description
      ) order by tx.occurred_at desc)
      from transactions tx
    ), '[]'::jsonb)
  ) into result
  from totals;

  return result;
end;
$$;

revoke all on function public.get_admin_activity_log(integer) from public, anon;
revoke all on function public.get_admin_revenue_report(date, date) from public, anon;
grant execute on function public.get_admin_activity_log(integer) to authenticated;
grant execute on function public.get_admin_revenue_report(date, date) to authenticated;

commit;
