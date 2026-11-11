begin;

create table if not exists public.payout_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  bank_name text not null,
  account_name text not null,
  account_number text not null,
  updated_at timestamptz not null default now()
);

alter table public.payout_accounts enable row level security;
revoke all on public.payout_accounts from anon, authenticated;

create table if not exists public.cod_remittances (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  rider_id uuid not null references public.profiles(id) on delete restrict,
  expected_amount numeric(10, 2) not null check (expected_amount > 0),
  transfer_reference text not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null
);

alter table public.cod_remittances enable row level security;
revoke all on public.cod_remittances from anon, authenticated;

create table if not exists public.marketplace_payouts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  beneficiary_id uuid not null references public.profiles(id) on delete restrict,
  payout_type text not null check (payout_type in ('seller', 'rider')),
  amount numeric(10, 2) not null check (amount > 0),
  status text not null default 'due' check (status in ('due', 'paid')),
  transfer_reference text,
  paid_at timestamptz,
  paid_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (order_id, beneficiary_id, payout_type)
);

alter table public.marketplace_payouts enable row level security;
revoke all on public.marketplace_payouts from anon, authenticated;

create index if not exists marketplace_payouts_status_created_idx
  on public.marketplace_payouts (status, created_at desc);
create index if not exists cod_remittances_status_submitted_idx
  on public.cod_remittances (status, submitted_at desc);

create table if not exists public.marketplace_collection_account (
  id boolean primary key default true check (id),
  bank_name text not null,
  account_name text not null,
  account_number text not null,
  updated_at timestamptz not null default now()
);

alter table public.marketplace_collection_account enable row level security;
revoke all on public.marketplace_collection_account from anon, authenticated;

create or replace function public.require_cod_collection_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.payment_method = 'cash_on_delivery'
    and not exists (
      select 1 from public.marketplace_collection_account account
      where account.id = true
    ) then
    raise exception 'Cash on delivery is temporarily unavailable until GetBuy configures its collection bank account.';
  end if;
  return new;
end;
$$;

drop trigger if exists require_cod_collection_account on public.orders;
create trigger require_cod_collection_account
before insert on public.orders
for each row execute function public.require_cod_collection_account();

create or replace function public.get_cod_collection_account()
returns table (bank_name text, account_name text, account_number text)
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'delivery'
  ) then
    raise exception 'A signed-in delivery partner account is required.';
  end if;
  return query
  select a.bank_name, a.account_name, a.account_number
  from public.marketplace_collection_account a
  where a.id = true;
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
  if not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
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

create or replace function public.get_my_payout_account()
returns table (bank_name text, account_name text, account_number text)
language sql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select a.bank_name, a.account_name, a.account_number
  from public.payout_accounts a
  where a.user_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('seller', 'delivery')
    );
$$;

create or replace function public.save_my_payout_account(
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
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('seller', 'delivery')
  ) then
    raise exception 'A signed-in seller or delivery partner account is required.';
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
  insert into public.payout_accounts (user_id, bank_name, account_name, account_number, updated_at)
  values (auth.uid(), trim(p_bank_name), trim(p_account_name), normalized_number, now())
  on conflict (user_id) do update
  set bank_name = excluded.bank_name,
      account_name = excluded.account_name,
      account_number = excluded.account_number,
      updated_at = now();
end;
$$;

create or replace function public.submit_cod_remittance(p_order_id uuid, p_transfer_reference text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  order_row public.orders%rowtype;
  affected_rows integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in before submitting a cash remittance.';
  end if;
  if nullif(trim(p_transfer_reference), '') is null or length(trim(p_transfer_reference)) > 120 then
    raise exception 'Enter the bank transfer reference for your remittance.';
  end if;
  select * into order_row
  from public.orders o
  where o.id = p_order_id
    and o.assigned_delivery_id = auth.uid()
    and o.status = 'completed'
    and o.payment_method = 'cash_on_delivery';
  if not found then
    raise exception 'Only completed cash orders assigned to you can be remitted.';
  end if;

  insert into public.cod_remittances (
    order_id, rider_id, expected_amount, transfer_reference, status, submitted_at, reviewed_at, reviewed_by
  )
  values (
    order_row.id, auth.uid(), order_row.total, trim(p_transfer_reference), 'pending', now(), null, null
  )
  on conflict (order_id) do update
  set expected_amount = excluded.expected_amount,
      transfer_reference = excluded.transfer_reference,
      status = 'pending',
      submitted_at = now(),
      reviewed_at = null,
      reviewed_by = null
  where public.cod_remittances.rider_id = auth.uid()
    and public.cod_remittances.status = 'rejected';

  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    raise exception 'This order remittance is already awaiting review or has been confirmed.';
  end if;
  return 'pending';
end;
$$;

create or replace function public.get_my_cod_remittances()
returns table (order_id uuid, expected_amount numeric, status text, transfer_reference text)
language sql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select o.id, o.total,
         coalesce(r.status, 'not_submitted'),
         coalesce(r.transfer_reference, '')
  from public.orders o
  left join public.cod_remittances r on r.order_id = o.id
  where o.assigned_delivery_id = auth.uid()
    and o.status = 'completed'
    and o.payment_method = 'cash_on_delivery'
  order by o.updated_at desc;
$$;

create or replace function public.get_my_payout_history()
returns table (
  order_id uuid,
  payout_type text,
  amount numeric,
  status text,
  transfer_reference text,
  paid_at timestamptz,
  remittance_status text
)
language sql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select payout.order_id,
         payout.payout_type,
         payout.amount,
         payout.status,
         coalesce(payout.transfer_reference, ''),
         payout.paid_at,
         coalesce(remittance.status, 'not_submitted')
  from public.marketplace_payouts payout
  left join public.cod_remittances remittance on remittance.order_id = payout.order_id
  where payout.beneficiary_id = auth.uid()
  order by payout.created_at desc
  limit 100;
$$;

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

create or replace function public.create_completed_order_payouts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    insert into public.marketplace_payouts (order_id, beneficiary_id, payout_type, amount)
    select new.id, s.owner_id, 'seller', round(sum(oi.quantity * oi.unit_price) * 0.95, 2)
    from public.order_items oi
    join public.products product on product.id = oi.product_id
    join public.stores s on s.id = product.store_id
    group by s.owner_id
    having round(sum(oi.quantity * oi.unit_price) * 0.95, 2) > 0
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

drop trigger if exists create_completed_order_payouts on public.orders;
create trigger create_completed_order_payouts
after update of status on public.orders
for each row execute function public.create_completed_order_payouts();

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
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
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
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
  end if;
  if nullif(trim(p_transfer_reference), '') is null or length(trim(p_transfer_reference)) > 120 then
    raise exception 'Enter the completed bank transfer reference.';
  end if;
  update public.marketplace_payouts payout
  set status = 'paid',
      transfer_reference = trim(p_transfer_reference),
      paid_at = now(),
      paid_by = auth.uid()
  where payout.id = p_payout_id
    and payout.status = 'due'
    and exists (
      select 1 from public.cod_remittances remittance
      where remittance.order_id = payout.order_id
        and remittance.status = 'confirmed'
    )
    and exists (
      select 1 from public.payout_accounts account
      where account.user_id = payout.beneficiary_id
    );
  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    raise exception 'Payout is blocked until the COD remittance is confirmed and the recipient has valid bank details.';
  end if;
end;
$$;

revoke all on function public.get_my_payout_account() from public, anon;
revoke all on function public.require_cod_collection_account() from public, anon, authenticated;
revoke all on function public.get_cod_collection_account() from public, anon;
revoke all on function public.admin_save_cod_collection_account(text, text, text) from public, anon;
revoke all on function public.save_my_payout_account(text, text, text) from public, anon;
revoke all on function public.submit_cod_remittance(uuid, text) from public, anon;
revoke all on function public.get_my_cod_remittances() from public, anon;
revoke all on function public.get_my_payout_history() from public, anon;
revoke all on function public.get_my_seller_payout_summary() from public, anon;
revoke all on function public.create_completed_order_payouts() from public, anon, authenticated;
revoke all on function public.get_admin_finance_dashboard() from public, anon;
revoke all on function public.admin_review_cod_remittance(uuid, boolean) from public, anon;
revoke all on function public.admin_mark_payout_paid(uuid, text) from public, anon;

grant execute on function public.get_my_payout_account() to authenticated;
grant execute on function public.get_cod_collection_account() to authenticated;
grant execute on function public.admin_save_cod_collection_account(text, text, text) to authenticated;
grant execute on function public.save_my_payout_account(text, text, text) to authenticated;
grant execute on function public.submit_cod_remittance(uuid, text) to authenticated;
grant execute on function public.get_my_cod_remittances() to authenticated;
grant execute on function public.get_my_payout_history() to authenticated;
grant execute on function public.get_my_seller_payout_summary() to authenticated;
grant execute on function public.get_admin_finance_dashboard() to authenticated;
grant execute on function public.admin_review_cod_remittance(uuid, boolean) to authenticated;
grant execute on function public.admin_mark_payout_paid(uuid, text) to authenticated;

commit;
