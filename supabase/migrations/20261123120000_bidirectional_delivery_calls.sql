begin;

create or replace function public.get_active_delivery_contact(p_order_id uuid)
returns table (phone_number text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.orders order_row
    where order_row.id = p_order_id
      and order_row.status = 'out_for_delivery'
      and (
        order_row.buyer_id = auth.uid()
        or order_row.assigned_delivery_id = auth.uid()
      )
  ) then
    raise exception 'Contact details are available only to the buyer and assigned rider during an active delivery.';
  end if;

  return query
  select case
    when order_row.buyer_id = auth.uid()
      and rider.rider_phone_sharing
      and length(regexp_replace(rider.phone_number, '[^0-9]', '', 'g')) between 10 and 15
      then rider.phone_number
    when order_row.assigned_delivery_id = auth.uid()
      and length(regexp_replace(buyer.phone_number, '[^0-9]', '', 'g')) between 10 and 15
      then buyer.phone_number
    else null
  end
  from public.orders order_row
  join public.profiles buyer on buyer.id = order_row.buyer_id
  join public.profiles rider on rider.id = order_row.assigned_delivery_id
  where order_row.id = p_order_id
    and order_row.status = 'out_for_delivery'
    and rider.role = 'delivery';
end;
$$;

revoke all on function public.get_active_delivery_contact(uuid) from public, anon;
grant execute on function public.get_active_delivery_contact(uuid) to authenticated;

commit;
