begin;

create table if not exists public.nin_verifications (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'unverified'
    check (status in ('unverified', 'pending', 'verified', 'failed')),
  requested_role text check (requested_role in ('seller', 'delivery')),
  consented_at timestamptz,
  last_attempt_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.nin_verifications enable row level security;
revoke all on public.nin_verifications from anon, authenticated;
grant select (user_id, status, verified_at, requested_role) on public.nin_verifications to authenticated;

drop policy if exists "Users can view their own NIN verification status" on public.nin_verifications;
create policy "Users can view their own NIN verification status"
  on public.nin_verifications for select to authenticated
  using (user_id = auth.uid());

insert into public.nin_verifications (user_id, status, requested_role)
select id, 'unverified', role::text
from public.profiles
where role in ('seller', 'delivery')
on conflict (user_id) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested_role text := new.raw_user_meta_data ->> 'role';
begin
  insert into public.profiles (id, full_name, role, phone_number)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'buyer'::public.user_role,
    coalesce(new.raw_user_meta_data ->> 'phone_number', '')
  )
  on conflict (id) do nothing;

  if requested_role in ('seller', 'delivery') then
    insert into public.nin_verifications (user_id, status, requested_role)
    values (new.id, 'unverified', requested_role)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() = old.id
    and new.role is distinct from old.role
    and current_setting('app.allow_nin_role_change', true) is distinct from 'on' then
    raise exception 'You cannot change your own account role.';
  end if;
  return new;
end;
$$;

create or replace function public.invalidate_nin_verification_on_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  previous_role_change_setting text := current_setting('app.allow_nin_role_change', true);
begin
  if new.full_name is distinct from old.full_name then
    update public.nin_verifications
    set status = 'unverified',
        consented_at = null,
        verified_at = null,
        updated_at = now()
    where user_id = old.id;
    if new.role in ('seller', 'delivery') then
      perform set_config('app.allow_nin_role_change', 'on', true);
      update public.profiles
      set role = 'buyer'
      where id = old.id;
      perform set_config('app.allow_nin_role_change', coalesce(previous_role_change_setting, ''), true);
    end if;
  elsif new.role is distinct from old.role and not exists (
    select 1
    from public.nin_verifications
    where user_id = old.id
      and requested_role = new.role::text
      and status in ('pending', 'verified')
  ) then
    update public.nin_verifications
    set status = 'unverified',
        consented_at = null,
        verified_at = null,
        updated_at = now()
    where user_id = old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists invalidate_nin_verification_after_profile_change on public.profiles;
create trigger invalidate_nin_verification_after_profile_change
after update of full_name, role on public.profiles
for each row execute function public.invalidate_nin_verification_on_profile_change();

create or replace function public.set_oauth_signup_role(p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  current_role public.user_role;
begin
  if auth.uid() is null then
    raise exception 'Sign in before selecting an account type.';
  end if;
  if p_role is null or p_role not in ('seller', 'delivery') then
    raise exception 'This account type cannot be selected here.';
  end if;
  if auth.jwt() -> 'app_metadata' ->> 'provider' not in ('google', 'facebook', 'apple') then
    raise exception 'Choose an account type during social account registration.';
  end if;

  select role into current_role
  from public.profiles
  where id = auth.uid()
  for update;
  if current_role is distinct from 'buyer'::public.user_role then
    raise exception 'This account already has an account type.';
  end if;
  if exists (select 1 from public.stores where owner_id = auth.uid())
    or exists (select 1 from public.delivery_partners where id = auth.uid())
    or exists (select 1 from public.orders where buyer_id = auth.uid()) then
    raise exception 'This existing account cannot change its account type.';
  end if;

  insert into public.nin_verifications (user_id, status, requested_role)
  values (auth.uid(), 'unverified', p_role)
  on conflict (user_id) do update
    set status = 'unverified',
        requested_role = excluded.requested_role,
        consented_at = null,
        verified_at = null,
        updated_at = now()
    where public.nin_verifications.status <> 'verified';

  if not found then
    raise exception 'This account already has a verified identity.';
  end if;
end;
$$;

create or replace function public.request_nin_verification(p_consent boolean)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  verification_row public.nin_verifications%rowtype;
  account_role public.user_role;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required.';
  end if;

  select role into account_role
  from public.profiles
  where id = auth.uid();

  if p_consent is distinct from true then
    raise exception 'Consent is required for NIN verification.';
  end if;

  insert into public.nin_verifications (user_id, requested_role)
  values (
    auth.uid(),
    case when account_role in ('seller', 'delivery') then account_role::text else null end
  )
  on conflict (user_id) do nothing;

  select * into verification_row
  from public.nin_verifications
  where user_id = auth.uid()
  for update;

  if verification_row.requested_role is null
    or verification_row.requested_role not in ('seller', 'delivery')
    or account_role is null
    or account_role not in ('buyer', 'seller', 'delivery')
    or (account_role in ('seller', 'delivery') and account_role::text <> verification_row.requested_role) then
    raise exception 'Only seller and rider accounts can verify a NIN.';
  end if;

  if verification_row.status = 'verified' then
    return 'verified';
  end if;

  if verification_row.last_attempt_at > now() - interval '1 minute' then
    return 'rate_limited';
  end if;

  update public.nin_verifications
  set status = 'pending',
      consented_at = now(),
      last_attempt_at = now(),
      verified_at = null,
      updated_at = now()
  where user_id = auth.uid();

  return 'started';
end;
$$;

create or replace function public.complete_nin_verification(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  verification_row public.nin_verifications%rowtype;
  account_role public.user_role;
  previous_role_change_setting text := current_setting('app.allow_nin_role_change', true);
begin
  select * into verification_row
  from public.nin_verifications
  where user_id = p_user_id
  for update;

  if not found
    or verification_row.status <> 'pending'
    or verification_row.consented_at is null
    or verification_row.requested_role not in ('seller', 'delivery') then
    raise exception 'NIN verification is not pending for this account.';
  end if;

  select role into account_role
  from public.profiles
  where id = p_user_id
  for update;

  if account_role = 'buyer' then
    perform set_config('app.allow_nin_role_change', 'on', true);
    update public.profiles
    set role = verification_row.requested_role::public.user_role
    where id = p_user_id;
    perform set_config('app.allow_nin_role_change', coalesce(previous_role_change_setting, ''), true);
  elsif account_role::text <> verification_row.requested_role then
    raise exception 'The account role no longer matches the NIN verification request.';
  end if;

  update public.nin_verifications
  set status = 'verified',
      verified_at = now(),
      updated_at = now()
  where user_id = p_user_id;
end;
$$;

revoke all on function public.set_oauth_signup_role(text) from public, anon;
revoke all on function public.request_nin_verification(boolean) from public, anon;
revoke all on function public.complete_nin_verification(uuid) from public, anon, authenticated;
grant execute on function public.set_oauth_signup_role(text) to authenticated;
grant execute on function public.request_nin_verification(boolean) to authenticated;
grant execute on function public.complete_nin_verification(uuid) to service_role;

commit;
