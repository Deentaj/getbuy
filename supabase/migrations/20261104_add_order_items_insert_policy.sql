do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'order_items'
      and policyname = 'Buyers can create their order items'
  ) then
    create policy "Buyers can create their order items"
      on public.order_items for insert
      with check (exists (
        select 1 from public.orders
        where orders.id = order_items.order_id
          and orders.buyer_id = auth.uid()
      ));
  end if;
end
$$;
