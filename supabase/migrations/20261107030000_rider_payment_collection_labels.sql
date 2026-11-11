begin;

create or replace function public.get_delivery_payment_details()
returns table (
  id uuid,
  payment_method text,
  payment_status text,
  payment_simulated boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role = 'delivery'
  ) then
    raise exception 'A delivery partner account is required.';
  end if;

  return query
  select order_row.id, order_row.payment_method, order_row.payment_status, order_row.payment_simulated
  from public.orders order_row
  where (order_row.payment_method <> 'monnify' or order_row.payment_status = 'paid')
    and (
      (
        order_row.assigned_delivery_id = auth.uid()
        and (
          order_row.status in ('ready', 'out_for_delivery')
          or (order_row.status = 'completed' and order_row.updated_at >= date_trunc('day', now()))
        )
      )
      or (order_row.status = 'ready' and order_row.assigned_delivery_id is null)
    );
end;
$$;

revoke all on function public.get_delivery_payment_details() from public, anon;
grant execute on function public.get_delivery_payment_details() to authenticated;

commit;
