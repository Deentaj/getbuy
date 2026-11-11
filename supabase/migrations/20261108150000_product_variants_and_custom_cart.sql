begin;

alter table public.products
  add column if not exists variant_options jsonb not null default '[]'::jsonb,
  add constraint products_variant_options_array_check
    check (jsonb_typeof(variant_options) = 'array');

alter table public.order_items
  alter column quantity type numeric(10, 2) using quantity::numeric,
  add column if not exists variant_id text,
  add column if not exists variant_label text,
  add column if not exists unit_snapshot text,
  add column if not exists custom_quantity boolean not null default false;

create or replace function public.validate_product_variant_options()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  variant_entry jsonb;
  variant_price numeric;
  variant_stock numeric;
begin
  if jsonb_array_length(new.variant_options) > 20 then
    raise exception 'A product can have up to 20 size options.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(new.variant_options) as variant_entry(value)
    group by variant_entry.value ->> 'id'
    having count(*) > 1
  ) then
    raise exception 'Size option IDs must be unique.';
  end if;
  for variant_entry in select value from jsonb_array_elements(new.variant_options)
  loop
    if jsonb_typeof(variant_entry) is distinct from 'object'
      or nullif(trim(variant_entry ->> 'id'), '') is null
      or nullif(trim(variant_entry ->> 'name'), '') is null
      or char_length(variant_entry ->> 'name') > 120
      or nullif(trim(variant_entry ->> 'unit'), '') is null
      or nullif(trim(variant_entry ->> 'price'), '') is null
      or nullif(trim(variant_entry ->> 'stock'), '') is null then
      raise exception 'Each size option needs an ID, name, unit, price, and stock amount.';
    end if;
    begin
      variant_price := (variant_entry ->> 'price')::numeric;
      variant_stock := (variant_entry ->> 'stock')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Each size option needs a valid price and stock amount.';
    end;
    if variant_price < 0 or variant_stock < 0
      or variant_price > 99999999.99 or variant_stock > 99999999.99
      or variant_price::text in ('NaN', 'Infinity', '-Infinity')
      or variant_stock::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'Size option prices and stock must be finite, non-negative amounts.';
    end if;
    if variant_price <> round(variant_price, 2) or variant_stock <> round(variant_stock, 2) then
      raise exception 'Size option prices and stock must use no more than two decimal places.';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists validate_product_variant_options on public.products;
create trigger validate_product_variant_options
  before insert or update on public.products
  for each row execute function public.validate_product_variant_options();

create or replace function public.prevent_removing_ordered_product_variants()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  old_variant jsonb;
  new_variant jsonb;
begin
  for old_variant in select value from jsonb_array_elements(old.variant_options)
  loop
    if exists (
      select 1 from public.order_items
      where product_id = old.id and variant_id = old_variant ->> 'id'
    ) then
      select variant_entry.value into new_variant
      from jsonb_array_elements(new.variant_options) as variant_entry(value)
      where variant_entry.value ->> 'id' = old_variant ->> 'id';
      if not found then
        raise exception 'A size option used in an order cannot be removed. Set its stock to zero instead.';
      end if;
      if new_variant ->> 'name' is distinct from old_variant ->> 'name'
        or new_variant ->> 'unit' is distinct from old_variant ->> 'unit' then
        raise exception 'The size or unit on an existing order cannot be changed. Add a new size option instead.';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists preserve_ordered_product_variants on public.products;
create trigger preserve_ordered_product_variants
  before update of variant_options on public.products
  for each row execute function public.prevent_removing_ordered_product_variants();

update public.order_items item
set unit_snapshot = product.unit
from public.products product
where item.product_id = product.id
  and item.unit_snapshot is null;

create or replace function public.restore_order_inventory(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  item_row record;
begin
  for item_row in
    select product_id, variant_id, quantity
    from public.order_items
    where order_id = p_order_id
  loop
    if item_row.variant_id is null then
      update public.products
      set stock_quantity = stock_quantity + item_row.quantity,
          is_available = true,
          updated_at = now()
      where id = item_row.product_id;
    else
      update public.products product
      set variant_options = (
            select coalesce(jsonb_agg(case
              when variant_entry.value ->> 'id' = item_row.variant_id then
                jsonb_set(variant_entry.value, '{stock}',
                  to_jsonb((variant_entry.value ->> 'stock')::numeric + item_row.quantity))
              else variant_entry.value
            end), '[]'::jsonb)
            from jsonb_array_elements(product.variant_options) as variant_entry(value)
          ),
          is_available = true,
          updated_at = now()
      where product.id = item_row.product_id
        and exists (
          select 1 from jsonb_array_elements(product.variant_options) as variant_entry(value)
          where variant_entry.value ->> 'id' = item_row.variant_id
        );
      if not found then raise exception 'The size used for an order is no longer configured; stock cannot be restored.'; end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.restore_order_inventory(uuid) from public, anon, authenticated;

create or replace function public.admin_set_product_availability(
  p_product_id uuid,
  p_is_available boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  affected_rows integer;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Administrator access is required.';
  end if;
  if p_is_available and not exists (
    select 1 from public.products product
    where product.id = p_product_id
      and (product.stock_quantity > 0 or exists (
        select 1 from jsonb_array_elements(product.variant_options) as variant_entry(value)
        where coalesce((variant_entry.value ->> 'stock')::numeric, 0) > 0
      ))
  ) then
    raise exception 'Products need available stock before they can be listed.';
  end if;
  update public.products set is_available = p_is_available, updated_at = now()
  where id = p_product_id;
  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then raise exception 'Product not found.'; end if;
end;
$$;

create or replace function public.notify_product_stock_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  old_has_stock boolean;
  new_has_stock boolean;
begin
  old_has_stock := old.stock_quantity > 0 or exists (
    select 1 from jsonb_array_elements(old.variant_options) as variant_entry(value)
    where coalesce((variant_entry.value ->> 'stock')::numeric, 0) > 0
  );
  new_has_stock := new.stock_quantity > 0 or exists (
    select 1 from jsonb_array_elements(new.variant_options) as variant_entry(value)
    where coalesce((variant_entry.value ->> 'stock')::numeric, 0) > 0
  );
  if new_has_stock and new.is_available and (not old_has_stock or old.is_available is false) then
    insert into public.marketplace_alerts (user_id, product_id, alert_type, message)
    select alert.buyer_id, new.id, 'back_in_stock',
      new.name || ' is back in stock at ' || store.name || '.'
    from public.product_stock_alerts alert
    join public.stores store on store.id = new.store_id
    where alert.product_id = new.id
    on conflict do nothing;
    insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body, payload)
    select alert.buyer_id, null, 'product_back_in_stock',
      'back_in_stock:' || new.id::text || ':' || alert.buyer_id::text || ':' || now()::date::text,
      'Back in stock', new.name || ' is available again at ' || store.name || '.',
      jsonb_build_object('product_id', new.id)
    from public.product_stock_alerts alert
    join public.stores store on store.id = new.store_id
    where alert.product_id = new.id
    on conflict (user_id, event_key) do nothing;
    update public.product_stock_alerts set notified_at = now()
    where product_id = new.id and notified_at is null;
  end if;
  if new.stock_quantity > 0 and new.stock_quantity <= 5 and new.is_available
    and (old.stock_quantity > 5 or old.stock_quantity <= 0 or old.is_available is false) then
    insert into public.marketplace_alerts (user_id, product_id, alert_type, message)
    select store.owner_id, new.id, 'low_stock',
      new.name || ' is low on stock (' || new.stock_quantity || ' left).'
    from public.stores store where store.id = new.store_id
    on conflict do nothing;
    insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body, payload)
    select store.owner_id, null, 'product_low_stock',
      'low_stock:' || new.id::text || ':' || new.stock_quantity::text,
      'Low stock alert', new.name || ' has only ' || new.stock_quantity || ' units left.',
      jsonb_build_object('product_id', new.id)
    from public.stores store where store.id = new.store_id
    on conflict (user_id, event_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_product_stock_changes on public.products;
create trigger notify_product_stock_changes
  after update of stock_quantity, is_available, variant_options on public.products
  for each row execute function public.notify_product_stock_changes();

create or replace function public.preview_store_promo_for_cart(p_code text, p_cart_items jsonb)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  promo_row public.store_promos%rowtype;
  seller_subtotal numeric(12, 2);
begin
  if auth.uid() is null then raise exception 'Sign in to apply a promo code.'; end if;
  if jsonb_typeof(p_cart_items) is distinct from 'array' then
    raise exception 'Select at least one cart item before applying a promo code.';
  end if;
  if jsonb_array_length(p_cart_items) = 0 then
    raise exception 'Select at least one cart item before applying a promo code.';
  end if;

  select * into promo_row from public.store_promos
    where code = upper(trim(coalesce(p_code, ''))) and active;
  if not found then raise exception 'This promo code is invalid or inactive.'; end if;
  if exists (
    select 1 from public.store_promo_redemptions
    where promo_id = promo_row.id and buyer_id = auth.uid()
  ) then raise exception 'You have already used this promo code.'; end if;

  select coalesce(sum(requested.quantity * case
      when requested.variant_id is null then product.price
      else (variant_match.value ->> 'price')::numeric
    end), 0)
    into seller_subtotal
  from jsonb_to_recordset(p_cart_items) as requested(product_id uuid, variant_id text, quantity numeric)
  join public.products product on product.id = requested.product_id
  left join lateral (
    select variant_entry.value
    from jsonb_array_elements(product.variant_options) as variant_entry(value)
    where variant_entry.value ->> 'id' = requested.variant_id
  ) variant_match on true
  where product.store_id = promo_row.store_id
    and requested.quantity > 0
    and (requested.variant_id is null or variant_match.value is not null);
  if seller_subtotal <= 0 then raise exception 'Your selected items do not include products from this store.'; end if;
  return round(seller_subtotal * promo_row.percent_off / 100.0, 2);
end;
$$;

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
  requested record;
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
    select distinct requested.product_id
    from jsonb_to_recordset(p_cart_items) as requested(product_id uuid, variant_id text, quantity numeric)
  ) item on item.product_id = product.id
  order by product.id
  for update of product;

  for requested in
    select item.product_id, item.variant_id, sum(item.quantity) as quantity
    from jsonb_to_recordset(p_cart_items) as item(product_id uuid, variant_id text, quantity numeric)
    group by item.product_id, item.variant_id
  loop
    if requested.quantity is null or requested.quantity <= 0 or requested.quantity > 99999999.99
      or requested.quantity <> round(requested.quantity, 2) then
      raise exception 'Each cart quantity must be greater than zero and have no more than two decimal places.';
    end if;
    select * into product_row from public.products where id = requested.product_id;
    if not found or not product_row.is_available then
      raise exception 'One or more products are unavailable.';
    end if;
    if requested.variant_id is null then
      if product_row.stock_quantity < requested.quantity then
        raise exception 'There is not enough stock for %.', product_row.name;
      end if;
    else
      select variant_entry.value into variant_option
      from jsonb_array_elements(product_row.variant_options) as variant_entry(value)
      where variant_entry.value ->> 'id' = requested.variant_id;
      if variant_option is null then raise exception 'A selected product size is no longer available.'; end if;
      if coalesce((variant_option ->> 'stock')::numeric, 0) < requested.quantity then
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

  for requested in
    select item.product_id, item.variant_id, sum(item.quantity) as quantity
    from jsonb_to_recordset(p_cart_items) as item(product_id uuid, variant_id text, quantity numeric)
    group by item.product_id, item.variant_id
  loop
    if requested.variant_id is null then
      update public.products product
      set stock_quantity = product.stock_quantity - requested.quantity,
          is_available = product.stock_quantity - requested.quantity > 0
            or exists (
              select 1 from jsonb_array_elements(product.variant_options) as variant_entry(value)
              where coalesce((variant_entry.value ->> 'stock')::numeric, 0) > 0
            ),
          updated_at = now()
      where product.id = requested.product_id;
    else
      update public.products product
      set variant_options = (
            select coalesce(jsonb_agg(case
              when variant_entry.value ->> 'id' = requested.variant_id then
                jsonb_set(variant_entry.value, '{stock}', to_jsonb((variant_entry.value ->> 'stock')::numeric - requested.quantity))
              else variant_entry.value
            end), '[]'::jsonb)
            from jsonb_array_elements(product.variant_options) as variant_entry(value)
          ),
          is_available = product.stock_quantity > 0
            or exists (
              select 1 from jsonb_array_elements(product.variant_options) as variant_entry(value)
              where coalesce((variant_entry.value ->> 'stock')::numeric, 0)
                - case when variant_entry.value ->> 'id' = requested.variant_id then requested.quantity else 0 end > 0
            ),
          updated_at = now()
      where product.id = requested.product_id;
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

create or replace function public.admin_cancel_unpaid_monnify_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  order_row public.orders%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Payment service access is required.'; end if;
  select * into order_row from public.orders where id = p_order_id for update;
  if not found or order_row.payment_method <> 'monnify'
    or order_row.payment_status <> 'pending' or order_row.status <> 'pending' then
    return false;
  end if;
  perform public.restore_order_inventory(p_order_id);
  update public.orders set payment_status = 'failed', status = 'cancelled', updated_at = now()
    where id = p_order_id;
  return true;
end;
$$;

create or replace function public.admin_record_payment_simulation(p_order_id uuid, p_result text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  order_row public.orders%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Payment simulator service access is required.'; end if;
  if p_result not in ('success', 'failure') then raise exception 'Choose a valid simulated payment result.'; end if;
  select * into order_row from public.orders where id = p_order_id for update;
  if found and order_row.payment_simulated and p_result = 'success'
    and order_row.payment_status = 'paid' then return 'paid'; end if;
  if found and order_row.payment_simulated and p_result = 'failure'
    and order_row.payment_status = 'failed' and order_row.status = 'cancelled' then return 'failed'; end if;
  if not found or not order_row.payment_simulated or order_row.payment_method <> 'monnify'
    or order_row.payment_status <> 'pending' or order_row.status <> 'pending' then
    raise exception 'This order is not awaiting a simulated payment.';
  end if;
  if p_result = 'success' then
    update public.orders set payment_status = 'paid', updated_at = now() where id = p_order_id;
    return 'paid';
  end if;
  perform public.restore_order_inventory(p_order_id);
  update public.orders set payment_status = 'failed', status = 'cancelled', updated_at = now()
    where id = p_order_id;
  return 'failed';
end;
$$;

create or replace function public.request_order_cancellation(p_order_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  order_row public.orders%rowtype;
  request_id uuid;
begin
  if auth.uid() is null or char_length(trim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'Enter a cancellation reason between 5 and 1000 characters.';
  end if;
  select * into order_row from public.orders
    where id = p_order_id and buyer_id = auth.uid() for update;
  if not found then raise exception 'This order is not associated with your account.'; end if;
  if order_row.status not in ('pending', 'accepted', 'preparing') then
    raise exception 'Cancellation is unavailable after the order is ready or delivery has begun.';
  end if;
  insert into public.order_cancellation_requests(order_id, buyer_id, reason, status, admin_note, reviewed_at)
  values (order_row.id, auth.uid(), trim(p_reason),
    case when order_row.status = 'pending' then 'approved' else 'pending' end,
    case when order_row.status = 'pending' then 'Automatically cancelled before seller acceptance.' else '' end,
    case when order_row.status = 'pending' then now() else null end)
  returning id into request_id;

  if order_row.status = 'pending' then
    perform public.restore_order_inventory(order_row.id);
    update public.orders set status = 'cancelled', updated_at = now() where id = order_row.id;
    if order_row.payment_method = 'monnify' and order_row.payment_status = 'paid' and not order_row.payment_simulated then
      insert into public.order_refunds(order_id, buyer_id, amount)
      values (order_row.id, order_row.buyer_id, order_row.total)
      on conflict (order_id) do nothing;
    end if;
    if order_row.loyalty_points_redeemed > 0 then
      insert into public.buyer_loyalty_transactions(user_id, order_id, points_delta, reason, transaction_key)
      values (order_row.buyer_id, order_row.id, order_row.loyalty_points_redeemed,
        'redemption_reversal', 'redemption_reversal:' || order_row.id::text)
      on conflict (transaction_key) do nothing;
    end if;
    insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body)
    values (order_row.buyer_id, order_row.id, 'order_cancelled', 'cancelled:' || order_row.id::text,
      'Order cancelled', 'Your order was cancelled. Any eligible online refund is pending manual review.')
    on conflict (user_id, event_key) do nothing;
  end if;
  return request_id;
end;
$$;

create or replace function public.admin_review_order_cancellation(
  p_request_id uuid, p_approve boolean, p_admin_note text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  request_row public.order_cancellation_requests%rowtype;
  order_row public.orders%rowtype;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Administrator access is required.';
  end if;
  select * into request_row from public.order_cancellation_requests where id = p_request_id for update;
  if not found or request_row.status <> 'pending' then
    raise exception 'This cancellation request is no longer pending.';
  end if;
  select * into order_row from public.orders where id = request_row.order_id for update;
  if p_approve and order_row.status not in ('accepted', 'preparing') then
    raise exception 'This order has advanced too far for cancellation.';
  end if;
  update public.order_cancellation_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      admin_note = left(trim(coalesce(p_admin_note, '')), 1000),
      reviewed_by = auth.uid(), reviewed_at = now()
  where id = request_row.id;
  if p_approve then
    perform public.restore_order_inventory(order_row.id);
    update public.orders set status = 'cancelled', updated_at = now() where id = order_row.id;
    if order_row.payment_method = 'monnify' and order_row.payment_status = 'paid' and not order_row.payment_simulated then
      insert into public.order_refunds(order_id, buyer_id, amount)
      values (order_row.id, order_row.buyer_id, order_row.total)
      on conflict (order_id) do nothing;
    end if;
    if order_row.loyalty_points_redeemed > 0 then
      insert into public.buyer_loyalty_transactions(user_id, order_id, points_delta, reason, transaction_key)
      values (order_row.buyer_id, order_row.id, order_row.loyalty_points_redeemed,
        'redemption_reversal', 'redemption_reversal:' || order_row.id::text)
      on conflict (transaction_key) do nothing;
    end if;
  end if;
  insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body)
  values (request_row.buyer_id, request_row.order_id, 'cancellation_update',
    'cancellation_update:' || request_row.id::text,
    case when p_approve then 'Cancellation approved' else 'Cancellation not approved' end,
    coalesce(nullif(trim(p_admin_note), ''),
      case when p_approve then 'Your order was cancelled.' else 'Your order will continue as planned.' end))
  on conflict (user_id, event_key) do nothing;
end;
$$;

revoke all on function public.preview_store_promo_for_cart(text, jsonb) from public, anon;
grant execute on function public.preview_store_promo_for_cart(text, jsonb) to authenticated;
revoke all on function public.create_marketplace_order_with_cart_options(text, text, jsonb, text, text, date, integer) from public, anon;
grant execute on function public.create_marketplace_order_with_cart_options(text, text, jsonb, text, text, date, integer) to authenticated;

commit;
