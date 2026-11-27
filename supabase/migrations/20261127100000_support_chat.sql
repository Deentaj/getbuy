begin;

create table if not exists public.support_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  assigned_staff_id uuid references auth.users(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  closed_at timestamptz
);

create unique index if not exists support_chat_one_open_per_customer
  on public.support_chat_conversations (customer_id)
  where status = 'open';

create index if not exists support_chat_open_assignment_updated
  on public.support_chat_conversations (assigned_staff_id, updated_at desc)
  where status = 'open';

create table if not exists public.support_chat_assignment_cursor (
  singleton boolean primary key default true check (singleton),
  last_staff_user_id uuid references auth.users(id) on delete set null
);

insert into public.support_chat_assignment_cursor (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.support_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_chat_conversations(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  sender_type text not null check (sender_type in ('customer', 'staff', 'bot')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  reply_to_message_id uuid unique references public.support_chat_messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint support_chat_message_sender_shape check (
    (sender_type = 'bot' and sender_id is null and reply_to_message_id is not null)
    or (sender_type in ('customer', 'staff') and reply_to_message_id is null)
  )
);

create index if not exists support_chat_messages_conversation_created
  on public.support_chat_messages (conversation_id, created_at);

alter table public.support_chat_conversations enable row level security;
alter table public.support_chat_messages enable row level security;
alter table public.support_chat_assignment_cursor enable row level security;

drop policy if exists "Customers and support staff can read support chats"
  on public.support_chat_conversations;
create policy "Customers and support staff can read support chats"
  on public.support_chat_conversations for select to authenticated
  using (
    customer_id = auth.uid()
    or (
      public.admin_has_permission('support')
      and (
        assigned_staff_id = auth.uid()
        or assigned_staff_id is null
        or public.get_admin_staff_role() = 'super_admin'
      )
    )
  );

drop policy if exists "Chat participants can read support messages"
  on public.support_chat_messages;
create policy "Chat participants can read support messages"
  on public.support_chat_messages for select to authenticated
  using (
    exists (
      select 1
      from public.support_chat_conversations conversation
      where conversation.id = support_chat_messages.conversation_id
        and (
          conversation.customer_id = auth.uid()
          or (
            public.admin_has_permission('support')
            and (
              conversation.assigned_staff_id = auth.uid()
              or conversation.assigned_staff_id is null
              or public.get_admin_staff_role() = 'super_admin'
            )
          )
        )
    )
  );

revoke all on public.support_chat_conversations, public.support_chat_messages,
  public.support_chat_assignment_cursor from public, anon, authenticated;
grant select on public.support_chat_conversations, public.support_chat_messages to authenticated;
grant all on public.support_chat_conversations, public.support_chat_messages,
  public.support_chat_assignment_cursor to service_role;

create or replace function public.touch_support_chat_conversation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  update public.support_chat_conversations
  set last_message_at = new.created_at,
      updated_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists support_chat_message_updates_conversation
  on public.support_chat_messages;
create trigger support_chat_message_updates_conversation
  after insert on public.support_chat_messages
  for each row execute function public.touch_support_chat_conversation();

create or replace function public.start_support_chat()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  conversation_id uuid;
  assigned_staff_id uuid;
  last_staff_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to contact customer service.';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'buyer'
  ) then
    raise exception 'A buyer account is required to contact customer service.';
  end if;

  perform pg_advisory_xact_lock(hashtext('getbuy-support-chat-assignment')::bigint);

  select id into conversation_id
  from public.support_chat_conversations
  where customer_id = auth.uid() and status = 'open'
  for update;
  if found then
    return conversation_id;
  end if;

  select cursor.last_staff_user_id into last_staff_user_id
  from public.support_chat_assignment_cursor cursor
  where cursor.singleton
  for update;

  select membership.user_id into assigned_staff_id
  from public.admin_staff_memberships membership
  where membership.role = 'customer_service'
  order by case
    when last_staff_user_id is null or membership.user_id > last_staff_user_id then 0
    else 1
  end, membership.user_id
  limit 1;

  insert into public.support_chat_conversations (customer_id, assigned_staff_id)
  values (auth.uid(), assigned_staff_id)
  returning id into conversation_id;

  if assigned_staff_id is not null then
    update public.support_chat_assignment_cursor
    set last_staff_user_id = assigned_staff_id
    where singleton;
  end if;

  return conversation_id;
end;
$$;

create or replace function public.claim_support_chat(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not public.admin_has_permission('support') then
    raise exception 'Customer service access is required.';
  end if;

  update public.support_chat_conversations
  set assigned_staff_id = auth.uid(),
      updated_at = now()
  where id = p_conversation_id
    and status = 'open'
    and assigned_staff_id is null;

  if not found then
    raise exception 'This chat is already assigned or closed.';
  end if;
  return true;
end;
$$;

create or replace function public.send_support_chat_message(
  p_conversation_id uuid,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  conversation public.support_chat_conversations%rowtype;
  sender_type text;
  message_id uuid;
  normalized_message text := btrim(coalesce(p_message, ''));
begin
  if auth.uid() is null then
    raise exception 'Sign in to send a message.';
  end if;
  if char_length(normalized_message) not between 1 and 2000 then
    raise exception 'Messages must contain between 1 and 2000 characters.';
  end if;

  select * into conversation
  from public.support_chat_conversations
  where id = p_conversation_id
  for update;
  if not found or conversation.status <> 'open' then
    raise exception 'This support chat is closed.';
  end if;

  if conversation.customer_id = auth.uid() then
    sender_type := 'customer';
  elsif public.admin_has_permission('support')
    and (
      conversation.assigned_staff_id = auth.uid()
      or public.get_admin_staff_role() = 'super_admin'
    ) then
    sender_type := 'staff';
  else
    raise exception 'You do not have access to this support chat.';
  end if;

  insert into public.support_chat_messages (
    conversation_id, sender_id, sender_type, body
  )
  values (p_conversation_id, auth.uid(), sender_type, normalized_message)
  returning id into message_id;

  return message_id;
end;
$$;

create or replace function public.close_support_chat(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not public.admin_has_permission('support') then
    raise exception 'Customer service access is required.';
  end if;

  update public.support_chat_conversations
  set status = 'closed',
      closed_at = now(),
      updated_at = now()
  where id = p_conversation_id
    and status = 'open'
    and (
      assigned_staff_id = auth.uid()
      or public.get_admin_staff_role() = 'super_admin'
    );

  if not found then
    raise exception 'This chat is not assigned to you or is already closed.';
  end if;
  return true;
end;
$$;

revoke all on function public.touch_support_chat_conversation() from public, anon, authenticated;
revoke all on function public.start_support_chat() from public, anon;
revoke all on function public.claim_support_chat(uuid) from public, anon;
revoke all on function public.send_support_chat_message(uuid, text) from public, anon;
revoke all on function public.close_support_chat(uuid) from public, anon;
grant execute on function public.start_support_chat() to authenticated;
grant execute on function public.claim_support_chat(uuid) to authenticated;
grant execute on function public.send_support_chat_message(uuid, text) to authenticated;
grant execute on function public.close_support_chat(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.support_chat_conversations;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.support_chat_messages;
exception
  when duplicate_object then null;
end;
$$;

commit;
