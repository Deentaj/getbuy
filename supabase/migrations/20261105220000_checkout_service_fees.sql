create or replace function public.create_marketplace_order(
  p_delivery_address text,
  p_payment_method text,
  p_product_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  new_order_id uuid;
  available_count integer;
  order_total numeric(10, 2);
  delivery_fee numeric(10, 2);
begin
  if auth.uid() is null then
    raise exception 'Sign in before placing an order.';
  end if;
  if nullif(trim(p_delivery_address), '') is null then
    raise exception 'A delivery address is required.';
  end if;
  if p_payment_method is distinct from 'cash_on_delivery' then
    raise exception 'This payment method is not supported.';
  end if;
  if p_product_ids is null or cardinality(p_product_ids) = 0 then
    raise exception 'Add at least one product before placing an order.';
  end if;

  perform p.id
  from public.products p
  join (
    select distinct requested_product.product_id
    from unnest(p_product_ids) as requested_product(product_id)
  ) requested on requested.product_id = p.id
  order by p.id
  for update of p;

  select count(*) into available_count
  from (
    select requested_product.product_id, count(*) as quantity
    from unnest(p_product_ids) as requested_product(product_id)
    group by requested_product.product_id
  ) requested
  join public.products p on p.id = requested.product_id
  where p.is_available = true
    and p.stock_quantity >= requested.quantity;
  if available_count <> (
    select count(*) from (
      select distinct requested_product.product_id
      from unnest(p_product_ids) as requested_product(product_id)
    ) requested
  ) then
    raise exception 'One or more products are unavailable or have insufficient stock.';
  end if;

  select coalesce(sum(p.price), 0) into order_total
  from unnest(p_product_ids) as requested(product_id)
  join public.products p on p.id = requested.product_id;

  delivery_fee := case
    when lower(trim(p_delivery_address)) like '%kubwa%' then 1000
    else 2000
  end;
  order_total := order_total + delivery_fee + 100 + 100;

  insert into public.orders (buyer_id, delivery_address, payment_method, total)
  values (auth.uid(), trim(p_delivery_address), p_payment_method, order_total)
  returning id into new_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price)
  select new_order_id, p.id, count(*), p.price
  from unnest(p_product_ids) as requested(product_id)
  join public.products p on p.id = requested.product_id
  group by p.id, p.price;

  update public.products p
  set stock_quantity = p.stock_quantity - requested.quantity,
      is_available = p.is_available and p.stock_quantity - requested.quantity > 0,
      updated_at = now()
  from (
    select requested_product.product_id, count(*) as quantity
    from unnest(p_product_ids) as requested_product(product_id)
    group by requested_product.product_id
  ) requested
  where p.id = requested.product_id;

  return new_order_id;
end;
$$;

revoke all on function public.create_marketplace_order(text, text, uuid[]) from public;
grant execute on function public.create_marketplace_order(text, text, uuid[]) to authenticated;
