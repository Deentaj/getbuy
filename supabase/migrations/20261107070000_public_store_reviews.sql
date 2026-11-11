create index if not exists store_reviews_store_created_at_idx
  on public.store_reviews(store_id, created_at desc);

create or replace function public.get_public_store_reviews(p_store_id uuid)
returns table (
  rating smallint,
  review text,
  created_at timestamptz,
  buyer_label text
)
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select
    store_review.rating,
    store_review.review,
    store_review.created_at,
    'Verified buyer'::text
  from public.store_reviews store_review
  where store_review.store_id = p_store_id
  order by store_review.created_at desc
  limit 50;
$$;

revoke all on function public.get_public_store_reviews(uuid) from public, anon, authenticated;
grant execute on function public.get_public_store_reviews(uuid) to anon, authenticated;
