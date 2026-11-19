begin;

create table if not exists public.store_monnify_subaccounts (
  store_id uuid primary key references public.stores(id) on delete cascade,
  sub_account_code text not null unique
    check (length(trim(sub_account_code)) between 1 and 120),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.store_monnify_subaccounts enable row level security;
revoke all on public.store_monnify_subaccounts from anon, authenticated;
grant select on public.store_monnify_subaccounts to authenticated;

create policy "Admins can view store Monnify subaccounts"
  on public.store_monnify_subaccounts for select
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role = 'admin'
  ));

create table if not exists public.monnify_order_splits (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  beneficiary_id uuid not null references public.profiles(id) on delete restrict,
  sub_account_code text not null,
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (order_id, store_id)
);

alter table public.monnify_order_splits enable row level security;
revoke all on public.monnify_order_splits from anon, authenticated;
grant select on public.monnify_order_splits to authenticated;

create policy "Admins can view Monnify order splits"
  on public.monnify_order_splits for select
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role = 'admin'
  ));

create policy "Sellers can view their Monnify order splits"
  on public.monnify_order_splits for select
  using (beneficiary_id = auth.uid());

create or replace function public.admin_set_store_monnify_subaccount(
  p_store_id uuid,
  p_sub_account_code text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  normalized_code text := nullif(trim(coalesce(p_sub_account_code, '')), '');
begin
  if not exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
  end if;
  if not exists (select 1 from public.stores where id = p_store_id) then
    raise exception 'Store not found.';
  end if;
  if normalized_code is null then
    delete from public.store_monnify_subaccounts where store_id = p_store_id;
    return;
  end if;
  if length(normalized_code) > 120 then
    raise exception 'The Monnify subaccount code is too long.';
  end if;

  insert into public.store_monnify_subaccounts (store_id, sub_account_code, updated_at, updated_by)
  values (p_store_id, normalized_code, now(), auth.uid())
  on conflict (store_id) do update
  set sub_account_code = excluded.sub_account_code,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;
end;
$$;

revoke all on function public.admin_set_store_monnify_subaccount(uuid, text) from public, anon;
grant execute on function public.admin_set_store_monnify_subaccount(uuid, text) to authenticated;

create or replace function public.record_monnify_order_splits_paid()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.payment_method = 'monnify'
    and new.payment_status = 'paid'
    and old.payment_status is distinct from new.payment_status then
    update public.monnify_order_splits
    set status = 'paid', paid_at = now()
    where order_id = new.id and status = 'pending';
  elsif new.payment_method = 'monnify'
    and (new.payment_status = 'failed' or new.status = 'cancelled')
    and (old.payment_status is distinct from new.payment_status
      or old.status is distinct from new.status) then
    update public.monnify_order_splits
    set status = 'cancelled'
    where order_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;

revoke all on function public.record_monnify_order_splits_paid() from public, anon, authenticated;
drop trigger if exists record_monnify_order_splits_paid on public.orders;
create trigger record_monnify_order_splits_paid
  after update of payment_status, status on public.orders
  for each row execute function public.record_monnify_order_splits_paid();

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
    if new.payment_method <> 'monnify' then
      insert into public.marketplace_payouts (order_id, beneficiary_id, payout_type, amount)
      select new.id, store.owner_id, 'seller',
        greatest(0, round(sum(item.quantity * item.unit_price)
          - case when bool_or(store.id = new.promo_store_id) then new.promo_discount else 0 end, 2))
      from public.order_items item
      join public.products product on product.id = item.product_id
      join public.stores store on store.id = product.store_id
      where item.order_id = new.id
      group by store.owner_id
      having greatest(0, round(sum(item.quantity * item.unit_price)
        - case when bool_or(store.id = new.promo_store_id) then new.promo_discount else 0 end, 2)) > 0
      on conflict (order_id, beneficiary_id, payout_type) do nothing;
    end if;

    if new.assigned_delivery_id is not null then
      insert into public.marketplace_payouts (order_id, beneficiary_id, payout_type, amount)
      values (new.id, new.assigned_delivery_id, 'rider', 1500)
      on conflict (order_id, beneficiary_id, payout_type) do nothing;
    end if;
  end if;
  return new;
end;
$$;

commit;
