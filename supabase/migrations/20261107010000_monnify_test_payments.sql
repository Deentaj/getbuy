begin;

alter table public.orders
  add column if not exists payment_status text not null default 'not_required'
    check (payment_status in ('not_required', 'pending', 'paid', 'failed')),
  add column if not exists payment_reference text unique,
  add column if not exists buyer_confirmed_at timestamptz;

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
  new_order_id uuid := gen_random_uuid();
  available_count integer;
  order_total numeric(10, 2);
  delivery_fee numeric(10, 2);
  new_payment_reference text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before placing an order.';
  end if;
  if nullif(trim(p_delivery_address), '') is null then
    raise exception 'A delivery address is required.';
  end if;
  if p_payment_method not in ('cash_on_delivery', 'monnify') then
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
  new_payment_reference := 'GB-' || replace(new_order_id::text, '-', '');

  insert into public.orders (
    id, buyer_id, delivery_address, payment_method, payment_status, payment_reference, total
  )
  values (
    new_order_id, auth.uid(), trim(p_delivery_address), p_payment_method,
    case when p_payment_method = 'monnify' then 'pending' else 'not_required' end,
    case when p_payment_method = 'monnify' then new_payment_reference else null end,
    order_total
  );

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

create or replace function public.admin_record_monnify_payment(
  p_order_id uuid,
  p_payment_reference text,
  p_amount_paid numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  order_row public.orders%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Payment verification service access is required.';
  end if;
  select * into order_row
  from public.orders
  where id = p_order_id
  for update;
  if not found or order_row.payment_method <> 'monnify'
    or order_row.payment_reference <> p_payment_reference
    or order_row.status = 'cancelled' then
    raise exception 'The payment does not match an active GetBuy order.';
  end if;
  if abs(coalesce(p_amount_paid, 0) - order_row.total) > 0.01 then
    raise exception 'The verified Monnify amount does not match the order total.';
  end if;
  if order_row.payment_status = 'paid' then
    return;
  end if;
  if order_row.payment_status <> 'pending' then
    raise exception 'This order is not awaiting payment.';
  end if;
  update public.orders
  set payment_status = 'paid', updated_at = now()
  where id = p_order_id;
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
  if auth.role() <> 'service_role' then
    raise exception 'Payment service access is required.';
  end if;
  select * into order_row
  from public.orders
  where id = p_order_id
  for update;
  if not found or order_row.payment_method <> 'monnify'
    or order_row.payment_status <> 'pending' or order_row.status <> 'pending' then
    return false;
  end if;
  update public.products p
  set stock_quantity = p.stock_quantity + item.quantity,
      is_available = true,
      updated_at = now()
  from public.order_items item
  where item.order_id = p_order_id and item.product_id = p.id;
  update public.orders
  set payment_status = 'failed', status = 'cancelled', updated_at = now()
  where id = p_order_id;
  return true;
end;
$$;

create or replace function public.prevent_unpaid_monnify_order_progress()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.status is distinct from old.status
    and old.payment_method = 'monnify'
    and old.payment_status <> 'paid'
    and not (
      new.status = 'cancelled'
      and new.payment_status = 'failed'
      and auth.role() = 'service_role'
    ) then
    raise exception 'This order cannot proceed until Monnify confirms payment.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_unpaid_monnify_order_progress on public.orders;
create trigger prevent_unpaid_monnify_order_progress
before update of status on public.orders
for each row execute function public.prevent_unpaid_monnify_order_progress();

drop policy if exists "Sellers can view their store orders" on public.orders;
create policy "Sellers can view their store orders"
  on public.orders for select
  using (
    public.is_seller_order(id)
    and (payment_method <> 'monnify' or payment_status = 'paid')
  );

drop policy if exists "Sellers can update their store orders" on public.orders;
create policy "Sellers can update their store orders"
  on public.orders for update
  using (
    public.is_seller_order(id)
    and (payment_method <> 'monnify' or payment_status = 'paid')
  )
  with check (public.is_seller_order(id));

drop policy if exists "Delivery partners can view assigned orders" on public.orders;
create policy "Delivery partners can view assigned orders"
  on public.orders for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'delivery')
    and (payment_method <> 'monnify' or payment_status = 'paid')
    and (
      assigned_delivery_id = auth.uid()
      or (status = 'ready' and assigned_delivery_id is null)
    )
  );

create or replace function public.can_view_marketplace_order_item(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and (
        o.buyer_id = auth.uid()
        or exists (
          select 1 from public.profiles
          where id = auth.uid() and role = 'admin'
        )
        or (
          (o.payment_method <> 'monnify' or o.payment_status = 'paid')
          and (
            exists (
              select 1
              from public.order_items oi
              join public.products p on p.id = oi.product_id
              join public.stores s on s.id = p.store_id
              where oi.order_id = o.id and s.owner_id = auth.uid()
            )
            or (
              exists (
                select 1 from public.profiles
                where id = auth.uid() and role = 'delivery'
              )
              and (
                o.assigned_delivery_id = auth.uid()
                or (o.status = 'ready' and o.assigned_delivery_id is null)
              )
            )
          )
        )
      )
  );
$$;

create or replace function public.create_completed_order_payouts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    insert into public.marketplace_payouts (order_id, beneficiary_id, payout_type, amount)
    select new.id, s.owner_id, 'seller', round(sum(oi.quantity * oi.unit_price), 2)
    from public.order_items oi
    join public.products product on product.id = oi.product_id
    join public.stores s on s.id = product.store_id
    group by s.owner_id
    having round(sum(oi.quantity * oi.unit_price), 2) > 0
    on conflict (order_id, beneficiary_id, payout_type) do nothing;

    if new.assigned_delivery_id is not null then
      insert into public.marketplace_payouts (order_id, beneficiary_id, payout_type, amount)
      values (new.id, new.assigned_delivery_id, 'rider', 1500)
      on conflict (order_id, beneficiary_id, payout_type) do nothing;
    end if;
  end if;
  return new;
end;
$$;

update public.marketplace_payouts payout
set amount = seller_sales.amount
from (
  select order_item.order_id, store.owner_id, round(sum(order_item.quantity * order_item.unit_price), 2) as amount
  from public.order_items order_item
  join public.products product on product.id = order_item.product_id
  join public.stores store on store.id = product.store_id
  group by order_item.order_id, store.owner_id
) seller_sales
where payout.order_id = seller_sales.order_id
  and payout.beneficiary_id = seller_sales.owner_id
  and payout.payout_type = 'seller'
  and payout.status = 'due';

drop trigger if exists create_completed_order_payouts on public.orders;
create trigger create_completed_order_payouts
after update of status on public.orders
for each row execute function public.create_completed_order_payouts();

create or replace function public.get_seller_dashboard_orders()
returns table (
  order_id uuid,
  status public.order_status,
  delivery_address text,
  total numeric,
  assigned_delivery_id uuid,
  items_summary text
)
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'seller'
  ) then
    raise exception 'A seller account is required.';
  end if;

  return query
  select
    o.id,
    o.status,
    o.delivery_address,
    sum(oi.quantity * oi.unit_price),
    o.assigned_delivery_id,
    string_agg(format('%s × %s %s', oi.quantity, p.name, p.unit), E'\n' order by p.name)
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  join public.products p on p.id = oi.product_id
  join public.stores s on s.id = p.store_id
  where s.owner_id = auth.uid()
    and (o.payment_method <> 'monnify' or o.payment_status = 'paid')
    and o.status in ('pending', 'accepted', 'preparing', 'ready')
  group by o.id
  order by o.created_at desc
  limit 10;
end;
$$;

create or replace function public.get_delivery_dashboard()
returns table (
  id uuid,
  status public.order_status,
  delivery_address text,
  total numeric,
  assigned_delivery_id uuid,
  buyer_name text,
  buyer_directions text,
  pickup_details text,
  items_summary text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'delivery'
  ) then
    raise exception 'A delivery partner account is required.';
  end if;

  return query
  select
    o.id,
    o.status,
    o.delivery_address,
    o.total,
    o.assigned_delivery_id,
    coalesce(buyer.full_name, ''),
    coalesce(buyer.directions, ''),
    coalesce(
      string_agg(distinct nullif(concat_ws(' · ', nullif(s.name, ''), nullif(s.market_area, ''), nullif(s.pickup_details, '')), ''), ' | '),
      'Pickup details unavailable'
    ),
    coalesce(string_agg(format('%s %s %s', oi.quantity, p.unit, p.name), ' + ' order by p.name), 'Order items unavailable'),
    o.updated_at
  from public.orders o
  left join public.profiles buyer on buyer.id = o.buyer_id
  left join public.order_items oi on oi.order_id = o.id
  left join public.products p on p.id = oi.product_id
  left join public.stores s on s.id = p.store_id
  where (o.payment_method <> 'monnify' or o.payment_status = 'paid')
    and (
      (
        o.assigned_delivery_id = auth.uid()
        and (
          o.status in ('ready', 'out_for_delivery')
          or (o.status = 'completed' and o.updated_at >= date_trunc('day', now()))
        )
      )
      or (o.status = 'ready' and o.assigned_delivery_id is null)
    )
  group by o.id, buyer.full_name, buyer.directions
  order by o.updated_at desc;
end;
$$;

create or replace function public.get_admin_finance_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
set row_security = off
as $$
declare
  result jsonb;
begin
  if not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
  end if;
  select jsonb_build_object(
    'collection_account', (
      select jsonb_build_object('bank_name', account.bank_name, 'account_name', account.account_name, 'account_number', account.account_number)
      from public.marketplace_collection_account account where account.id = true
    ),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', payout.id,
        'order_id', payout.order_id,
        'beneficiary_id', payout.beneficiary_id,
        'payout_type', payout.payout_type,
        'amount', payout.amount,
        'status', payout.status,
        'transfer_reference', payout.transfer_reference,
        'created_at', payout.created_at,
        'beneficiary_name', profile.full_name,
        'beneficiary_email', account_user.email,
        'bank_name', account.bank_name,
        'account_name', account.account_name,
        'account_number', account.account_number,
        'store_names', case when payout.payout_type = 'seller' then coalesce((
          select string_agg(distinct store.name, ', ' order by store.name)
          from public.order_items order_item
          join public.products product on product.id = order_item.product_id
          join public.stores store on store.id = product.store_id
          where order_item.order_id = payout.order_id and store.owner_id = payout.beneficiary_id
        ), '') else '' end,
        'remittance_status', case
          when order_row.buyer_confirmed_at is null then 'waiting_for_buyer'
          when order_row.payment_method = 'monnify' and order_row.payment_status = 'paid' then 'payment_verified'
          else coalesce(remittance.status, 'not_submitted')
        end
      ) order by payout.created_at desc)
      from public.marketplace_payouts payout
      join public.orders order_row on order_row.id = payout.order_id
      join public.profiles profile on profile.id = payout.beneficiary_id
      join auth.users account_user on account_user.id = payout.beneficiary_id
      left join public.payout_accounts account on account.user_id = payout.beneficiary_id
      left join public.cod_remittances remittance on remittance.order_id = payout.order_id
      where payout.status = 'due'
    ), '[]'::jsonb),
    'remittances', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', remittance.id,
        'order_id', remittance.order_id,
        'rider_id', remittance.rider_id,
        'rider_name', profile.full_name,
        'rider_email', account_user.email,
        'expected_amount', remittance.expected_amount,
        'transfer_reference', remittance.transfer_reference,
        'status', remittance.status,
        'submitted_at', remittance.submitted_at
      ) order by remittance.submitted_at)
      from public.cod_remittances remittance
      join public.profiles profile on profile.id = remittance.rider_id
      join auth.users account_user on account_user.id = remittance.rider_id
      where remittance.status = 'pending'
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.confirm_order_received(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  order_row public.orders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in before confirming delivery.';
  end if;
  select * into order_row
  from public.orders
  where id = p_order_id and buyer_id = auth.uid()
  for update;
  if not found then
    raise exception 'This order is not associated with your account.';
  end if;
  if order_row.status <> 'completed' then
    raise exception 'You can confirm receipt after the rider marks the delivery complete.';
  end if;
  if order_row.payment_method = 'monnify' and order_row.payment_status <> 'paid' then
    raise exception 'Payment must be verified before confirming receipt.';
  end if;
  if order_row.buyer_confirmed_at is null then
    update public.orders
    set buyer_confirmed_at = now(), updated_at = now()
    where id = p_order_id;
  end if;
end;
$$;

create or replace function public.admin_mark_payout_paid(p_payout_id uuid, p_transfer_reference text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  affected_rows integer;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
  end if;
  if nullif(trim(p_transfer_reference), '') is null or length(trim(p_transfer_reference)) > 120 then
    raise exception 'Enter the completed bank transfer reference.';
  end if;
  update public.marketplace_payouts payout
  set status = 'paid',
      transfer_reference = trim(p_transfer_reference),
      paid_at = now(),
      paid_by = auth.uid()
  from public.orders order_row
  where payout.order_id = order_row.id
    and payout.id = p_payout_id
    and payout.status = 'due'
    and order_row.buyer_confirmed_at is not null
    and (
      (order_row.payment_method = 'monnify' and order_row.payment_status = 'paid')
      or (
        order_row.payment_method = 'cash_on_delivery'
        and exists (
          select 1 from public.cod_remittances remittance
          where remittance.order_id = payout.order_id and remittance.status = 'confirmed'
        )
      )
    )
    and exists (
      select 1 from public.payout_accounts account
      where account.user_id = payout.beneficiary_id
    );
  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    raise exception 'Payout is blocked until the buyer confirms receipt, payment or COD remittance is verified, and the recipient has valid bank details.';
  end if;
end;
$$;

create or replace function public.get_my_seller_payout_summary()
returns table (awaiting_reconciliation numeric, ready_for_payout numeric, paid_to_date numeric)
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'seller'
  ) then
    raise exception 'A signed-in seller account is required.';
  end if;
  return query
  select
    coalesce(sum(payout.amount) filter (
      where payout.status = 'due' and not (
        order_row.buyer_confirmed_at is not null
        and (
          (order_row.payment_method = 'monnify' and order_row.payment_status = 'paid')
          or (order_row.payment_method = 'cash_on_delivery' and remittance.status = 'confirmed')
        )
      )
    ), 0)::numeric,
    coalesce(sum(payout.amount) filter (
      where payout.status = 'due'
        and order_row.buyer_confirmed_at is not null
        and (
          (order_row.payment_method = 'monnify' and order_row.payment_status = 'paid')
          or (order_row.payment_method = 'cash_on_delivery' and remittance.status = 'confirmed')
        )
    ), 0)::numeric,
    coalesce(sum(payout.amount) filter (where payout.status = 'paid'), 0)::numeric
  from public.marketplace_payouts payout
  join public.orders order_row on order_row.id = payout.order_id
  left join public.cod_remittances remittance on remittance.order_id = payout.order_id
  where payout.beneficiary_id = auth.uid() and payout.payout_type = 'seller';
end;
$$;

create or replace function public.get_my_rider_payout_summary()
returns table (earned_today numeric, awaiting_reconciliation numeric, ready_for_payout numeric, paid_to_date numeric)
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'delivery'
  ) then
    raise exception 'A signed-in delivery partner account is required.';
  end if;
  return query
  select
    coalesce(sum(payout.amount) filter (
      where payout.created_at >= date_trunc('day', now())
    ), 0)::numeric,
    coalesce(sum(payout.amount) filter (
      where payout.status = 'due' and not (
        order_row.buyer_confirmed_at is not null
        and (
          (order_row.payment_method = 'monnify' and order_row.payment_status = 'paid')
          or (order_row.payment_method = 'cash_on_delivery' and remittance.status = 'confirmed')
        )
      )
    ), 0)::numeric,
    coalesce(sum(payout.amount) filter (
      where payout.status = 'due'
        and order_row.buyer_confirmed_at is not null
        and (
          (order_row.payment_method = 'monnify' and order_row.payment_status = 'paid')
          or (order_row.payment_method = 'cash_on_delivery' and remittance.status = 'confirmed')
        )
    ), 0)::numeric,
    coalesce(sum(payout.amount) filter (where payout.status = 'paid'), 0)::numeric
  from public.marketplace_payouts payout
  join public.orders order_row on order_row.id = payout.order_id
  left join public.cod_remittances remittance on remittance.order_id = payout.order_id
  where payout.beneficiary_id = auth.uid() and payout.payout_type = 'rider';
end;
$$;

revoke all on function public.admin_record_monnify_payment(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.admin_record_monnify_payment(uuid, text, numeric) to service_role;
revoke all on function public.admin_cancel_unpaid_monnify_order(uuid) from public, anon, authenticated;
grant execute on function public.admin_cancel_unpaid_monnify_order(uuid) to service_role;
revoke all on function public.confirm_order_received(uuid) from public, anon;
grant execute on function public.confirm_order_received(uuid) to authenticated;

commit;
