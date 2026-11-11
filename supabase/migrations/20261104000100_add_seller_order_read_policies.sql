do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'orders'
      and policyname = 'Sellers can view orders containing their products'
  ) then
    create policy "Sellers can view orders containing their products"
      on public.orders for select
      using (exists (
        select 1
        from public.order_items
        join public.products on products.id = order_items.product_id
        join public.stores on stores.id = products.store_id
        where order_items.order_id = orders.id
          and stores.owner_id = auth.uid()
      ));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'order_items'
      and policyname = 'Sellers can view order items for their products'
  ) then
    create policy "Sellers can view order items for their products"
      on public.order_items for select
      using (exists (
        select 1
        from public.products
        join public.stores on stores.id = products.store_id
        where products.id = order_items.product_id
          and stores.owner_id = auth.uid()
      ));
  end if;
end
$$;
