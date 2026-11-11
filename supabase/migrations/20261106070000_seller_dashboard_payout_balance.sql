begin;

create or replace function public.get_my_seller_payout_summary()
returns table (
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
    where p.id = auth.uid() and p.role = 'seller'
  ) then
    raise exception 'A signed-in seller account is required.';
  end if;
  return query
  select
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
    and payout.payout_type = 'seller';
end;
$$;

revoke all on function public.get_my_seller_payout_summary() from public, anon;
grant execute on function public.get_my_seller_payout_summary() to authenticated;

commit;
