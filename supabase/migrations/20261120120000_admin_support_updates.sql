begin;

alter table public.user_notifications drop constraint if exists user_notifications_event_type_check;
alter table public.user_notifications add constraint user_notifications_event_type_check
  check (event_type in (
    'new_order', 'order_ready', 'new_chat_message', 'product_back_in_stock',
    'product_low_stock', 'loyalty_reward', 'referral_reward', 'order_cancelled',
    'cancellation_update', 'refund_update', 'support_update'
  ));

create or replace function public.update_order_issue(
  p_issue_id uuid,
  p_status text,
  p_admin_note text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  issue_row public.order_issues%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required.';
  end if;
  if p_status not in ('open', 'in_review', 'resolved')
    or char_length(coalesce(p_admin_note, '')) > 1000 then
    raise exception 'Choose a valid issue status and an admin note under 1000 characters.';
  end if;
  update public.order_issues
  set status = p_status, admin_note = trim(coalesce(p_admin_note, '')), updated_at = now()
  where id = p_issue_id
  returning * into issue_row;
  if not found then
    raise exception 'This issue report no longer exists.';
  end if;

  insert into public.user_notifications(user_id, order_id, event_type, event_key, title, body)
  values (
    issue_row.buyer_id,
    issue_row.order_id,
    'support_update',
    'support_update:' || issue_row.id::text || ':' || to_char(issue_row.updated_at, 'YYYYMMDDHH24MISSUS'),
    'Support case updated',
    'GetBuy support updated your report for order #' || left(issue_row.order_id::text, 6) ||
      ' to ' || replace(issue_row.status, '_', ' ') ||
      case when nullif(trim(issue_row.admin_note), '') is null then '.'
        else ': ' || trim(issue_row.admin_note) end
  );
end;
$$;

revoke all on function public.update_order_issue(uuid, text, text) from public, anon;
grant execute on function public.update_order_issue(uuid, text, text) to authenticated;

commit;
