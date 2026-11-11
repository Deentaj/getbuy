begin;

create or replace function public.create_marketplace_order_with_cart_options(
  p_delivery_address text,
  p_payment_method text,
  p_cart_items jsonb,
  p_delivery_slot text,
  p_promo_code text,
  p_delivery_date date,
  p_loyalty_points integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  new_order_id uuid;
  product_row public.products%rowtype;
  promo_row public.store_promos%rowtype;
  cart_request record;
  variant_option jsonb;
  product_subtotal numeric(12, 2);
  eligible_subtotal numeric(12, 2);
  delivery_fee numeric(10, 2);
  discount numeric(10, 2) := 0;
  requested_points integer := coalesce(p_loyalty_points, 0);
  user_points bigint;
  local_hour integer;
begin
  if auth.uid() is null then raise exception 'Sign in before placing an order.'; end if;
  if nullif(trim(p_delivery_address), '') is null then raise exception 'A delivery address is required.'; end if;
  if p_payment_method is distinct from 'cash_on_delivery' and p_payment_method is distinct from 'monnify' then
    raise exception 'This payment method is not supported.';
  end if;
  if p_delivery_slot is null or p_delivery_slot not in ('morning', 'afternoon', 'evening') then
    raise exception 'Choose a valid delivery time window.';
  end if;
  if p_delivery_date is null or p_delivery_date < (now() at time zone 'Africa/Lagos')::date
    or p_delivery_date > (now() at time zone 'Africa/Lagos')::date + 14 then
    raise exception 'Choose a delivery date within the next 14 days.';
  end if;
  local_hour := extract(hour from (now() at time zone 'Africa/Lagos'));
  if p_delivery_date = (now() at time zone 'Africa/Lagos')::date
    and ((p_delivery_slot = 'morning' and local_hour >= 12)
      or (p_delivery_slot = 'afternoon' and local_hour >= 16)
      or (p_delivery_slot = 'evening' and local_hour >= 20)) then
    raise exception 'That delivery window has passed. Choose a later window or another date.';
  end if;
  if requested_points < 0 then raise exception 'Rewards points cannot be negative.'; end if;
  if jsonb_typeof(p_cart_items) is distinct from 'array' then
    raise exception 'Add between 1 and 100 products before placing an order.';
  end if;
  if jsonb_array_length(p_cart_items) = 0 or jsonb_array_length(p_cart_items) > 100 then
    raise exception 'Add between 1 and 100 products before placing an order.';
  end if;

  perform 1 from public.profiles where id = auth.uid() for update;
  perform product.id
  from public.products product
  join (
    select distinct cart_entry.product_id
    from jsonb_to_recordset(p_cart_items) as cart_entry(product_id uuid, variant_id text, quantity numeric)
  ) item on item.product_id = product.id
  order by product.id
  for update of product;

  for cart_request in
    select item.product_id, item.variant_id, sum(item.quantity) as quantity
    from jsonb_to_recordset(p_cart_items) as item(product_id uuid, variant_id text, quantity numeric)
    group by item.product_id, item.variant_id
  loop
    if cart_request.quantity is null or cart_request.quantity <= 0 or cart_request.quantity > 99999999.99
      or cart_request.quantity <> round(cart_request.quantity, 2) then
      raise exception 'Each cart quantity must be greater than zero and have no more than two decimal places.';
    end if;
    select * into product_row from public.products where id = cart_request.product_id;
    if not found or not product_row.is_available then
      raise exception 'One or more products are unavailable.';
    end if;
    if cart_request.variant_id is null then
      if product_row.stock_quantity < cart_request.quantity then
        raise exception 'There is not enough stock for %.', product_row.name;
      end if;
    else
      select variant_entry.value into variant_option
      from jsonb_array_elements(product_row.variant_options) as variant_entry(value)
      where variant_entry.value ->> 'id' = cart_request.variant_id;
      if variant_option is null then raise exception 'A selected product size is no longer available.'; end if;
      if coalesce((variant_option ->> 'stock')::numeric, 0) < cart_request.quantity then
        raise exception 'There is not enough stock for % (%).', product_row.name, variant_option ->> 'name';
      end if;
    end if;
  end loop;

  if requested_points > 0 then
    select coalesce(sum(points_delta), 0) into user_points
      from public.buyer_loyalty_transactions where user_id = auth.uid();
    if requested_points > user_points then raise exception 'You do not have enough rewards points.'; end if;
  else
    user_points := 0;
  end if;

  select coalesce(sum(item.quantity * case
      when item.variant_id is null then product.price
      else (variant_match.value ->> 'price')::numeric
    end), 0)
    into product_subtotal
  from jsonb_to_recordset(p_cart_items) as item(product_id uuid, variant_id text, quantity numeric)
  join public.products product on product.id = item.product_id
  left join lateral (
    select variant_entry.value
    from jsonb_array_elements(product.variant_options) as variant_entry(value)
    where variant_entry.value ->> 'id' = item.variant_id
  ) variant_match on true;
  eligible_subtotal := product_subtotal;

  delivery_fee := case when lower(trim(p_delivery_address)) like '%kubwa%' then 1000 else 2000 end;
  insert into public.orders (buyer_id, delivery_address, payment_method, total, delivery_slot, delivery_date)
  values (
    auth.uid(), trim(p_delivery_address), p_payment_method,
    product_subtotal + delivery_fee + 200, p_delivery_slot, p_delivery_date
  )
  returning id into new_order_id;

  insert into public.order_items (
    order_id, product_id, quantity, unit_price, variant_id, variant_label, unit_snapshot, custom_quantity
  )
  select
    new_order_id,
    item.product_id,
    item.quantity,
    case when item.variant_id is null then product.price else (variant_match.value ->> 'price')::numeric end,
    item.variant_id,
    variant_match.value ->> 'name',
    case when item.variant_id is null then product.unit else coalesce(variant_match.value ->> 'unit', 'pack') end,
    item.variant_id is null
  from jsonb_to_recordset(p_cart_items) as item(product_id uuid, variant_id text, quantity numeric)
  join public.products product on product.id = item.product_id
  left join lateral (
    select variant_entry.value
    from jsonb_array_elements(product.variant_options) as variant_entry(value)
    where variant_entry.value ->> 'id' = item.variant_id
  ) variant_match on true;

  for cart_request in
    select item.product_id, item.variant_id, sum(item.quantity) as quantity
    from jsonb_to_recordset(p_cart_items) as item(product_id uuid, variant_id text, quantity numeric)
    group by item.product_id, item.variant_id
  loop
    if cart_request.variant_id is null then
      update public.products product
      set stock_quantity = product.stock_quantity - cart_request.quantity,
          is_available = product.stock_quantity - cart_request.quantity > 0
            or exists (
              select 1 from jsonb_array_elements(product.variant_options) as variant_entry(value)
              where coalesce((variant_entry.value ->> 'stock')::numeric, 0) > 0
            ),
          updated_at = now()
      where product.id = cart_request.product_id;
    else
      update public.products product
      set variant_options = (
            select coalesce(jsonb_agg(case
              when variant_entry.value ->> 'id' = cart_request.variant_id then
                jsonb_set(variant_entry.value, '{stock}', to_jsonb((variant_entry.value ->> 'stock')::numeric - cart_request.quantity))
              else variant_entry.value
            end), '[]'::jsonb)
            from jsonb_array_elements(product.variant_options) as variant_entry(value)
          ),
          is_available = product.stock_quantity > 0
            or exists (
              select 1 from jsonb_array_elements(product.variant_options) as variant_entry(value)
              where coalesce((variant_entry.value ->> 'stock')::numeric, 0)
                - case when variant_entry.value ->> 'id' = cart_request.variant_id then cart_request.quantity else 0 end > 0
            ),
          updated_at = now()
      where product.id = cart_request.product_id;
    end if;
  end loop;

  if nullif(trim(coalesce(p_promo_code, '')), '') is not null then
    select * into promo_row from public.store_promos
      where code = upper(trim(p_promo_code)) and active for update;
    if not found then raise exception 'This promo code is invalid or inactive.'; end if;
    if exists (
      select 1 from public.store_promo_redemptions
      where promo_id = promo_row.id and buyer_id = auth.uid()
    ) then raise exception 'You have already used this promo code.'; end if;
    select coalesce(sum(item.quantity * item.unit_price), 0) into product_subtotal
      from public.order_items item
      join public.products product on product.id = item.product_id
      where item.order_id = new_order_id and product.store_id = promo_row.store_id;
    if product_subtotal <= 0 then raise exception 'Your cart has no products from this store.'; end if;
    discount := round(product_subtotal * promo_row.percent_off / 100.0, 2);
    update public.orders set promo_id = promo_row.id, promo_store_id = promo_row.store_id,
      promo_code = promo_row.code, promo_discount = discount, total = total - discount
      where id = new_order_id;
    insert into public.store_promo_redemptions(promo_id, buyer_id, order_id)
      values (promo_row.id, auth.uid(), new_order_id);
  end if;

  if requested_points > 0 then
    discount := least(requested_points, floor(eligible_subtotal * 0.1), user_points);
    if discount > 0 then
      update public.orders set loyalty_discount = discount,
        loyalty_points_redeemed = discount::integer, total = total - discount
        where id = new_order_id;
      insert into public.buyer_loyalty_transactions(user_id, order_id, points_delta, reason, transaction_key)
      values (auth.uid(), new_order_id, -discount::integer, 'order_redemption', 'redeem:' || new_order_id::text);
    end if;
  end if;
  return new_order_id;
end;
$$;

revoke all on function public.create_marketplace_order_with_cart_options(text, text, jsonb, text, text, date, integer) from public, anon;
grant execute on function public.create_marketplace_order_with_cart_options(text, text, jsonb, text, text, date, integer) to authenticated;

commit;
