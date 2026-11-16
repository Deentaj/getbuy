create table if not exists public.rider_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  rider_id uuid not null references public.profiles(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  review text not null default '' check (char_length(review) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists rider_reviews_rider_created_at_idx
  on public.rider_reviews(rider_id, created_at desc);

alter table public.rider_reviews enable row level security;
revoke all on public.rider_reviews from anon, authenticated;
grant select on public.rider_reviews to authenticated;

drop policy if exists "Buyers and riders can view their order reviews" on public.rider_reviews;
create policy "Buyers and riders can view their order reviews"
  on public.rider_reviews for select
  using (
    buyer_id = auth.uid()
    or rider_id = auth.uid()
    or public.is_admin()
  );

create or replace function public.submit_rider_review(
  p_order_id uuid,
  p_rating smallint,
  p_review text
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
  if auth.uid() is null or p_rating is null or p_rating not between 1 and 5
    or char_length(coalesce(p_review, '')) > 1000 then
    raise exception 'Provide a rider rating from 1 to 5 and a review under 1000 characters.';
  end if;

  select * into order_row
  from public.orders
  where id = p_order_id and buyer_id = auth.uid()
  for update;
  if not found
    or order_row.status <> 'completed'
    or order_row.buyer_confirmed_at is null
    or order_row.assigned_delivery_id is null
    or (order_row.payment_method = 'monnify' and order_row.payment_status <> 'paid') then
    raise exception 'You can rate the rider after confirming receipt of a completed order.';
  end if;

  insert into public.rider_reviews (order_id, rider_id, buyer_id, rating, review)
  values (order_row.id, order_row.assigned_delivery_id, auth.uid(), p_rating, trim(coalesce(p_review, '')))
  on conflict (order_id) do update
  set rating = excluded.rating, review = excluded.review, created_at = now();
end;
$$;

revoke all on function public.submit_rider_review(uuid, smallint, text) from public, anon;
grant execute on function public.submit_rider_review(uuid, smallint, text) to authenticated;

create or replace function public.get_public_store_rating_summaries(p_store_ids uuid[])
returns table (
  store_id uuid,
  average_rating numeric,
  review_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select
    store_review.store_id,
    round(avg(store_review.rating)::numeric, 1),
    count(*)::bigint
  from public.store_reviews store_review
  where store_review.store_id = any(coalesce(p_store_ids, '{}'::uuid[]))
  group by store_review.store_id;
$$;

revoke all on function public.get_public_store_rating_summaries(uuid[]) from public, anon, authenticated;
grant execute on function public.get_public_store_rating_summaries(uuid[]) to anon, authenticated;

notify pgrst, 'reload schema';
