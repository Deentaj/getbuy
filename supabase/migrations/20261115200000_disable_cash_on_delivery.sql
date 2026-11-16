begin;

alter table public.orders
  alter column payment_method set default 'monnify';

create or replace function public.prevent_new_cash_on_delivery_orders()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.payment_method = 'cash_on_delivery' then
    raise exception 'Cash on delivery is no longer available. Choose an online payment method.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_new_cash_on_delivery_orders on public.orders;
create trigger prevent_new_cash_on_delivery_orders
before insert or update of payment_method on public.orders
for each row execute function public.prevent_new_cash_on_delivery_orders();

commit;
