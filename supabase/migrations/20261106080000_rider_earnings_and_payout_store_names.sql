begin;

create or replace function public.get_my_rider_payout_summary()
returns table (
  earned_today numeric,
  awaiting_reconciliation numeric,
  ready_for_payout numeric,
  paid_to_date numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'delivery'
  ) then
    raise exception 'A signed-in delivery partner account is required.';
  end if;
  return query
  select
    coalesce(sum(payout.amount) filter (
      where payout.created_at >= date_trunc('day', now())
    ), 0)::numeric,
    coalesce(sum(payout.amount) filter (
      where payout.status = 'due'
        and coalesce(remittance.status, 'not_submitted') <> 'confirmed'
    ), 0)::numeric,
    coalesce(sum(payout.amount) filter (
      where payout.status = 'due'
        and remittance.status = 'confirmed'
    ), 0)::numeric,
    coalesce(sum(payout.amount) filter (where payout.status = 'paid'), 0)::numeric
  from public.marketplace_payouts payout
  left join public.cod_remittances remittance on remittance.order_id = payout.order_id
  where payout.beneficiary_id = auth.uid()
    and payout.payout_type = 'rider';
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
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
  end if;
  select jsonb_build_object(
    'collection_account', (
      select jsonb_build_object(
        'bank_name', account.bank_name,
        'account_name', account.account_name,
        'account_number', account.account_number
      )
      from public.marketplace_collection_account account
      where account.id = true
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
          where order_item.order_id = payout.order_id
            and store.owner_id = payout.beneficiary_id
        ), '') else '' end,
        'remittance_status', coalesce(remittance.status, 'not_submitted')
      ) order by payout.created_at desc)
      from public.marketplace_payouts payout
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

revoke all on function public.get_my_rider_payout_summary() from public, anon;
grant execute on function public.get_my_rider_payout_summary() to authenticated;

commit;
