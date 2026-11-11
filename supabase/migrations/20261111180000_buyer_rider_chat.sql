create table if not exists public.order_rider_chat_threads (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  rider_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.order_rider_chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.order_rider_chat_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists order_rider_chat_messages_thread_created_idx
  on public.order_rider_chat_messages(thread_id, created_at);

alter table public.order_rider_chat_threads enable row level security;
alter table public.order_rider_chat_messages enable row level security;
revoke all on public.order_rider_chat_threads, public.order_rider_chat_messages from anon, authenticated;
grant select on public.order_rider_chat_threads, public.order_rider_chat_messages to authenticated;

drop policy if exists "Assigned rider and buyer can view rider chat threads" on public.order_rider_chat_threads;
create policy "Assigned rider and buyer can view rider chat threads"
  on public.order_rider_chat_threads for select to authenticated
  using (
    exists (
      select 1 from public.orders order_row
      where order_row.id = order_rider_chat_threads.order_id
        and order_row.buyer_id = order_rider_chat_threads.buyer_id
        and (order_row.buyer_id = auth.uid() or order_row.assigned_delivery_id = auth.uid())
    )
  );

drop policy if exists "Assigned rider and buyer can view rider chat messages" on public.order_rider_chat_messages;
create policy "Assigned rider and buyer can view rider chat messages"
  on public.order_rider_chat_messages for select to authenticated
  using (
    exists (
      select 1
      from public.order_rider_chat_threads thread
      join public.orders order_row on order_row.id = thread.order_id
      where thread.id = order_rider_chat_messages.thread_id
        and thread.buyer_id = order_row.buyer_id
        and (order_row.buyer_id = auth.uid() or order_row.assigned_delivery_id = auth.uid())
    )
  );

create or replace function public.get_or_create_order_rider_chat(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  order_row public.orders%rowtype;
  chat_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to open order chat.'; end if;
  select * into order_row from public.orders where id = p_order_id;
  if not found or order_row.status = 'cancelled' then
    raise exception 'This order is not available for chat.';
  end if;
  if order_row.assigned_delivery_id is null then
    raise exception 'Buyer and rider chat becomes available after a rider is assigned.';
  end if;
  if auth.uid() <> order_row.buyer_id and auth.uid() <> order_row.assigned_delivery_id then
    raise exception 'Only this order’s buyer and assigned rider can open this chat.';
  end if;

  insert into public.order_rider_chat_threads (order_id, buyer_id, rider_id)
  values (order_row.id, order_row.buyer_id, order_row.assigned_delivery_id)
  on conflict (order_id) do update
    set buyer_id = excluded.buyer_id, rider_id = excluded.rider_id
  returning id into chat_id;
  return chat_id;
end;
$$;

create or replace function public.send_order_rider_chat_message(p_thread_id uuid, p_message text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  new_message_id uuid;
begin
  if auth.uid() is null
    or char_length(trim(coalesce(p_message, ''))) not between 1 and 2000 then
    raise exception 'Enter a message between 1 and 2000 characters.';
  end if;
  if not exists (
    select 1
    from public.order_rider_chat_threads thread
    join public.orders order_row on order_row.id = thread.order_id
    where thread.id = p_thread_id
      and thread.buyer_id = order_row.buyer_id
      and thread.rider_id = order_row.assigned_delivery_id
      and (order_row.buyer_id = auth.uid() or order_row.assigned_delivery_id = auth.uid())
  ) then raise exception 'You are not a participant in this order chat.'; end if;
  insert into public.order_rider_chat_messages (thread_id, sender_id, message)
  values (p_thread_id, auth.uid(), trim(p_message))
  returning id into new_message_id;
  return new_message_id;
end;
$$;

revoke all on function public.get_or_create_order_rider_chat(uuid) from public, anon;
revoke all on function public.send_order_rider_chat_message(uuid, text) from public, anon;
grant execute on function public.get_or_create_order_rider_chat(uuid) to authenticated;
grant execute on function public.send_order_rider_chat_message(uuid, text) to authenticated;

revoke all on function public.get_or_create_order_chat(uuid, uuid) from public, anon, authenticated;
revoke all on function public.send_order_chat_message(uuid, text) from public, anon, authenticated;
drop policy if exists "Order chat participants can view threads" on public.order_chat_threads;
drop policy if exists "Order chat participants can view messages" on public.order_chat_messages;
drop trigger if exists notify_order_chat_message on public.order_chat_messages;

create or replace function public.notify_order_rider_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  thread_row public.order_rider_chat_threads%rowtype;
  order_row public.orders%rowtype;
  recipient_id uuid;
begin
  select * into thread_row from public.order_rider_chat_threads where id = new.thread_id;
  select * into order_row from public.orders where id = thread_row.order_id;
  recipient_id := case
    when new.sender_id = thread_row.buyer_id then order_row.assigned_delivery_id
    else thread_row.buyer_id
  end;
  if recipient_id is not null then
    insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body, payload)
    values (
      recipient_id, thread_row.order_id, 'new_chat_message',
      'rider-chat:' || new.id::text, 'New order message',
      'You have a new message about order #' || left(thread_row.order_id::text, 6) || '.',
      jsonb_build_object('thread_id', thread_row.id, 'chat_type', 'buyer_rider')
    ) on conflict (user_id, event_key) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.notify_order_rider_chat_message() from public, anon, authenticated;
drop trigger if exists notify_order_rider_chat_message on public.order_rider_chat_messages;
create trigger notify_order_rider_chat_message
  after insert on public.order_rider_chat_messages
  for each row execute function public.notify_order_rider_chat_message();

alter publication supabase_realtime add table public.order_rider_chat_messages;

notify pgrst, 'reload schema';
