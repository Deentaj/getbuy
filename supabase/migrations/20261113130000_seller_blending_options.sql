begin;

alter table public.products
  add column if not exists blending_available boolean not null default false,
  add column if not exists blending_fee numeric(10, 2) not null default 0
    check (blending_fee >= 0);

alter table public.order_items
  add column if not exists blending_requested boolean not null default false,
  add column if not exists blending_fee numeric(10, 2) not null default 0
    check (blending_fee >= 0);

create or replace function public.create_marketplace_order_with_blending_options(
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
  blending_total numeric(12, 2);
begin
  if jsonb_typeof(p_cart_items) = 'array'
    and exists (
      select 1
      from jsonb_array_elements(p_cart_items) as entry(value)
      where entry.value ? 'blending_requested'
        and jsonb_typeof(entry.value -> 'blending_requested') not in ('boolean', 'null')
    ) then
    raise exception 'Choose whether each item should be blended.';
  end if;

  if jsonb_typeof(p_cart_items) = 'array'
    and exists (
      select 1
      from jsonb_to_recordset(p_cart_items) as item(
        product_id uuid,
        variant_id text,
        quantity numeric,
        blending_requested boolean
      )
      group by item.product_id, item.variant_id
      having bool_or(coalesce(item.blending_requested, false))
        and bool_or(not coalesce(item.blending_requested, false))
    ) then
    raise exception 'A product and size can only have one preparation choice per order.';
  end if;

  new_order_id := public.create_marketplace_order_with_cart_options(
    p_delivery_address,
    p_payment_method,
    p_cart_items,
    p_delivery_slot,
    p_promo_code,
    p_delivery_date,
    p_loyalty_points
  );

  if exists (
    select 1
    from jsonb_to_recordset(p_cart_items) as item(
      product_id uuid,
      variant_id text,
      quantity numeric,
      blending_requested boolean
    )
    join public.products product on product.id = item.product_id
    where coalesce(item.blending_requested, false)
      and not product.blending_available
  ) then
    raise exception 'Blending is no longer available for one or more selected products.';
  end if;

  select coalesce(sum(item.quantity * product.blending_fee), 0)
  into blending_total
  from jsonb_to_recordset(p_cart_items) as item(
    product_id uuid,
    variant_id text,
    quantity numeric,
    blending_requested boolean
  )
  join public.products product on product.id = item.product_id
  where coalesce(item.blending_requested, false);

  with requested_options as (
    select
      item.product_id,
      item.variant_id,
      bool_or(coalesce(item.blending_requested, false)) as blending_requested
    from jsonb_to_recordset(p_cart_items) as item(
      product_id uuid,
      variant_id text,
      quantity numeric,
      blending_requested boolean
    )
    group by item.product_id, item.variant_id
  )
  update public.order_items order_item
  set blending_requested = requested_options.blending_requested,
      blending_fee = case when requested_options.blending_requested then product.blending_fee else 0 end,
      unit_price = order_item.unit_price
        + case when requested_options.blending_requested then product.blending_fee else 0 end
  from requested_options
  join public.products product on product.id = requested_options.product_id
  where order_item.order_id = new_order_id
    and order_item.product_id = requested_options.product_id
    and order_item.variant_id is not distinct from requested_options.variant_id;

  update public.orders
  set total = total + blending_total
  where id = new_order_id;

  return new_order_id;
end;
$$;

revoke all on function public.create_marketplace_order_with_blending_options(text, text, jsonb, text, text, date, integer)
  from public, anon;
grant execute on function public.create_marketplace_order_with_blending_options(text, text, jsonb, text, text, date, integer)
  to authenticated;

notify pgrst, 'reload schema';

commit;
