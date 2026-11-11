begin;

create or replace function public.ensure_monnify_order_payment_details()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.payment_method = 'monnify' then
    if new.payment_status is null or new.payment_status = 'not_required' then
      new.payment_status := 'pending';
    end if;
    if new.payment_reference is null then
      new.payment_reference := 'GB-' || replace(new.id::text, '-', '');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_monnify_order_payment_details on public.orders;
create trigger ensure_monnify_order_payment_details
  before insert on public.orders
  for each row execute function public.ensure_monnify_order_payment_details();

do $$
declare
  invalid_order record;
begin
  for invalid_order in
    select id
    from public.orders
    where payment_method = 'monnify'
      and payment_status = 'not_required'
      and payment_reference is null
      and status = 'pending'
    for update
  loop
    perform public.restore_order_inventory(invalid_order.id);
    update public.orders
    set payment_status = 'failed',
        status = 'cancelled',
        updated_at = now()
    where id = invalid_order.id;
  end loop;
end;
$$;

commit;
