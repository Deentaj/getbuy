begin;

create table public.account_login_throttles (
  scope text not null check (scope in ('account', 'ip')),
  identifier_hash text not null check (identifier_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (scope, identifier_hash)
);

create index account_login_throttles_updated_at_idx
  on public.account_login_throttles (updated_at);

alter table public.account_login_throttles enable row level security;
revoke all on public.account_login_throttles from public, anon, authenticated;

create or replace function public.account_login_check_throttle(
  p_account_hash text,
  p_ip_hash text
)
returns table (is_blocked boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  throttle_row public.account_login_throttles%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Login protection service access is required.';
  end if;
  if p_account_hash !~ '^[0-9a-f]{64}$' or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid login protection identifiers.';
  end if;

  select * into throttle_row
  from public.account_login_throttles
  where scope = 'account' and identifier_hash = p_account_hash;
  if found and throttle_row.locked_until > now() then
    return query select true, greatest(1, ceil(extract(epoch from throttle_row.locked_until - now()))::integer);
    return;
  end if;

  select * into throttle_row
  from public.account_login_throttles
  where scope = 'ip' and identifier_hash = p_ip_hash;
  if found and throttle_row.locked_until > now() then
    return query select true, greatest(1, ceil(extract(epoch from throttle_row.locked_until - now()))::integer);
    return;
  end if;

  return query select false, 0;
end;
$$;

create or replace function public.account_login_consume_ip_attempt(p_ip_hash text)
returns table (is_allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  throttle_row public.account_login_throttles%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Login protection service access is required.';
  end if;
  if p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid login protection identifier.';
  end if;

  delete from public.account_login_throttles
  where updated_at < now() - interval '1 day';

  insert into public.account_login_throttles (scope, identifier_hash)
  values ('ip', p_ip_hash)
  on conflict (scope, identifier_hash) do nothing;

  select * into throttle_row
  from public.account_login_throttles
  where scope = 'ip' and identifier_hash = p_ip_hash
  for update;

  if throttle_row.locked_until > now() then
    return query select false, greatest(1, ceil(extract(epoch from throttle_row.locked_until - now()))::integer);
    return;
  end if;

  if throttle_row.window_started_at <= now() - interval '15 minutes' then
    update public.account_login_throttles
    set window_started_at = now(), attempts = 0, locked_until = null, updated_at = now()
    where scope = 'ip' and identifier_hash = p_ip_hash
    returning * into throttle_row;
  end if;

  if throttle_row.attempts >= 20 then
    update public.account_login_throttles
    set locked_until = now() + interval '15 minutes', updated_at = now()
    where scope = 'ip' and identifier_hash = p_ip_hash
    returning * into throttle_row;
    return query select false, 900;
    return;
  end if;

  update public.account_login_throttles
  set attempts = attempts + 1, updated_at = now()
  where scope = 'ip' and identifier_hash = p_ip_hash;

  return query select true, 0;
end;
$$;

create or replace function public.account_login_record_failure(p_account_hash text)
returns table (is_locked boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  throttle_row public.account_login_throttles%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Login protection service access is required.';
  end if;
  if p_account_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid login protection identifier.';
  end if;

  insert into public.account_login_throttles (scope, identifier_hash)
  values ('account', p_account_hash)
  on conflict (scope, identifier_hash) do nothing;

  select * into throttle_row
  from public.account_login_throttles
  where scope = 'account' and identifier_hash = p_account_hash
  for update;

  if throttle_row.locked_until > now() then
    return query select true, greatest(1, ceil(extract(epoch from throttle_row.locked_until - now()))::integer);
    return;
  end if;

  if throttle_row.window_started_at <= now() - interval '15 minutes' then
    update public.account_login_throttles
    set window_started_at = now(), attempts = 0, locked_until = null, updated_at = now()
    where scope = 'account' and identifier_hash = p_account_hash
    returning * into throttle_row;
  end if;

  update public.account_login_throttles
  set attempts = attempts + 1,
      locked_until = case when attempts + 1 >= 5 then now() + interval '15 minutes' else null end,
      updated_at = now()
  where scope = 'account' and identifier_hash = p_account_hash
  returning * into throttle_row;

  if throttle_row.locked_until > now() then
    return query select true, greatest(1, ceil(extract(epoch from throttle_row.locked_until - now()))::integer);
    return;
  end if;

  return query select false, 0;
end;
$$;

create or replace function public.account_login_clear_failures(p_account_hash text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Login protection service access is required.';
  end if;
  if p_account_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid login protection identifier.';
  end if;
  delete from public.account_login_throttles
  where scope = 'account' and identifier_hash = p_account_hash;
end;
$$;

revoke all on function public.account_login_check_throttle(text, text) from public, anon, authenticated;
revoke all on function public.account_login_consume_ip_attempt(text) from public, anon, authenticated;
revoke all on function public.account_login_record_failure(text) from public, anon, authenticated;
revoke all on function public.account_login_clear_failures(text) from public, anon, authenticated;
grant execute on function public.account_login_check_throttle(text, text) to service_role;
grant execute on function public.account_login_consume_ip_attempt(text) to service_role;
grant execute on function public.account_login_record_failure(text) to service_role;
grant execute on function public.account_login_clear_failures(text) to service_role;

commit;
