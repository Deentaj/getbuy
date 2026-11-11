begin;

alter table public.profiles
  add column if not exists phone_number text not null default '';

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
    case
      when requested_role in ('buyer', 'seller', 'delivery') then requested_role::public.user_role
      else 'buyer'::public.user_role
    end,
    coalesce(new.raw_user_meta_data ->> 'phone_number', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

commit;
