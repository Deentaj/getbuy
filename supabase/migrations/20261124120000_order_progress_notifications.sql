begin;

alter table public.user_notifications
  drop constraint if exists user_notifications_event_type_check;

alter table public.user_notifications
  add constraint user_notifications_event_type_check
  check (event_type in (
    'new_order', 'order_ready', 'new_chat_message', 'product_back_in_stock',
    'product_low_stock', 'loyalty_reward', 'referral_reward', 'order_cancelled',
    'cancellation_update', 'refund_update', 'support_update',
    'delivery_fee_request', 'order_progress'
  ));

create or replace function public.notify_order_progress()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  progress_title text;
  progress_body text;
  progress_key text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  progress_title := case new.status
    when 'accepted' then 'Order accepted'
    when 'preparing' then 'Order is being prepared'
    when 'ready' then 'Order ready'
    when 'out_for_delivery' then 'Rider is on the way'
    when 'completed' then 'Order delivered'
    when 'cancelled' then 'Order cancelled'
    else 'Order update'
  end;
  progress_body := 'Order #' || left(new.id::text, 6) || ' is now ' ||
    replace(new.status, '_', ' ') || '. Tap to view its progress.';
  progress_key := 'order_progress:' || new.id::text || ':' ||
    to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISSUS');

  insert into public.user_notifications (
    user_id, order_id, event_type, event_key, title, body, payload
  )
  values (
    new.buyer_id, new.id, 'order_progress', progress_key,
    progress_title, progress_body,
    jsonb_build_object('order_id', new.id, 'status', new.status)
  );

  insert into public.user_notifications (
    user_id, order_id, event_type, event_key, title, body, payload
  )
  select distinct rider_id, new.id, 'order_progress',
    progress_key || ':' || rider_id::text,
    progress_title, progress_body,
    jsonb_build_object('order_id', new.id, 'status', new.status)
  from (
    select fulfillment.rider_id
    from public.order_delivery_fulfillments fulfillment
    where fulfillment.order_id = new.id and fulfillment.rider_id is not null
    union
    select new.assigned_delivery_id
    where new.assigned_delivery_id is not null
  ) assigned_riders;

  return new;
end;
$$;

revoke all on function public.notify_order_progress() from public, anon, authenticated;

drop trigger if exists notify_order_progress_after_status_change on public.orders;
create trigger notify_order_progress_after_status_change
  after update of status on public.orders
  for each row
  execute function public.notify_order_progress();

commit;
