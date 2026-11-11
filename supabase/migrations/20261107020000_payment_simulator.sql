begin;

alter table public.orders
  add column if not exists payment_simulated boolean not null default false;

create or replace function public.admin_prepare_payment_simulation(
  p_order_id uuid,
  p_buyer_id uuid
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
  if auth.role() <> 'service_role' then
    raise exception 'Payment simulator service access is required.';
  end if;
  update public.orders
  set payment_simulated = true, updated_at = now()
  where id = p_order_id
    and buyer_id = p_buyer_id
    and payment_method = 'monnify'
    and payment_status = 'pending'
    and status = 'pending'
    and payment_simulated = false;
  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    raise exception 'This order cannot be prepared for payment simulation.';
  end if;
end;
$$;

create or replace function public.admin_record_payment_simulation(
  p_order_id uuid,
  p_result text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  order_row public.orders%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Payment simulator service access is required.';
  end if;
  if p_result not in ('success', 'failure') then
    raise exception 'Choose a valid simulated payment result.';
  end if;
  select * into order_row
  from public.orders
  where id = p_order_id
  for update;
  if found and order_row.payment_simulated and p_result = 'success'
    and order_row.payment_status = 'paid' then
    return 'paid';
  end if;
  if found and order_row.payment_simulated and p_result = 'failure'
    and order_row.payment_status = 'failed' and order_row.status = 'cancelled' then
    return 'failed';
  end if;
  if not found or not order_row.payment_simulated
    or order_row.payment_method <> 'monnify'
    or order_row.payment_status <> 'pending'
    or order_row.status <> 'pending' then
    raise exception 'This order is not awaiting a simulated payment.';
  end if;

  if p_result = 'success' then
    update public.orders
    set payment_status = 'paid', updated_at = now()
    where id = p_order_id;
    return 'paid';
  end if;

  update public.products product
  set stock_quantity = product.stock_quantity + item.quantity,
      is_available = true,
      updated_at = now()
  from public.order_items item
  where item.order_id = p_order_id and item.product_id = product.id;
  update public.orders
  set payment_status = 'failed', status = 'cancelled', updated_at = now()
  where id = p_order_id;
  return 'failed';
end;
$$;

create or replace function public.create_completed_order_payouts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status
    and not new.payment_simulated then
    insert into public.marketplace_payouts (order_id, beneficiary_id, payout_type, amount)
    select new.id, store.owner_id, 'seller', round(sum(item.quantity * item.unit_price), 2)
    from public.order_items item
    join public.products product on product.id = item.product_id
    join public.stores store on store.id = product.store_id
    group by store.owner_id
    having round(sum(item.quantity * item.unit_price), 2) > 0
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

revoke all on function public.admin_prepare_payment_simulation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_prepare_payment_simulation(uuid, uuid) to service_role;
revoke all on function public.admin_record_payment_simulation(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_record_payment_simulation(uuid, text) to service_role;

commit;
