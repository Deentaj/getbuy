drop policy if exists "Buyers can view their saved products" on public.products;
create policy "Buyers can view their saved products"
  on public.products for select
  using (
    exists (
      select 1 from public.product_favorites favorite
      where favorite.product_id = products.id and favorite.buyer_id = auth.uid()
    )
  );
