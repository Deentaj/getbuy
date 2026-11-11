create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
    and new.role is distinct from old.role
    and current_setting('app.allow_oauth_role_change', true) is distinct from 'on'
    and not public.is_admin() then
    raise exception 'Only an administrator can change account roles.';
  end if;
  return new;
end;
$$;

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
  if p_role not in ('seller', 'delivery') then
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

  perform set_config('app.allow_oauth_role_change', 'on', true);
  update public.profiles
  set role = p_role::public.user_role
  where id = auth.uid();
end;
$$;

revoke all on function public.set_oauth_signup_role(text) from public;
grant execute on function public.set_oauth_signup_role(text) to authenticated;
