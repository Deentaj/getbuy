begin;

create table if not exists public.product_favorites (
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (buyer_id, product_id)
);

alter table public.product_favorites enable row level security;
grant select, insert, delete on public.product_favorites to authenticated;

drop policy if exists "Buyers manage their product favorites" on public.product_favorites;
create policy "Buyers manage their product favorites"
  on public.product_favorites for all
  using (buyer_id = auth.uid())
  with check (buyer_id = auth.uid());

create table if not exists public.order_item_substitutions (
  order_item_id uuid primary key references public.order_items(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  substitute_product_id uuid not null references public.products(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

alter table public.order_item_substitutions enable row level security;
revoke all on public.order_item_substitutions from anon, authenticated;
grant select on public.order_item_substitutions to authenticated;

drop policy if exists "Order buyers can view substitution offers" on public.order_item_substitutions;
create policy "Order buyers can view substitution offers"
  on public.order_item_substitutions for select
  using (
    exists (
      select 1
      from public.order_items item
      where item.id = order_item_substitutions.order_item_id
        and public.is_order_buyer(item.order_id)
    )
  );

drop policy if exists "Sellers can view their substitution offers" on public.order_item_substitutions;
create policy "Sellers can view their substitution offers"
  on public.order_item_substitutions for select
  using (seller_id = auth.uid());

create or replace function public.prevent_ready_with_pending_substitution()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.status = 'ready' and old.status is distinct from new.status and exists (
    select 1
    from public.order_items item
    join public.order_item_substitutions offer on offer.order_item_id = item.id
    where item.order_id = new.id and offer.status = 'pending'
  ) then
    raise exception 'Wait for the buyer to approve or decline all substitutions before marking the order ready.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_ready_with_pending_substitution on public.orders;
create trigger prevent_ready_with_pending_substitution
  before update of status on public.orders
  for each row execute function public.prevent_ready_with_pending_substitution();

create or replace function public.offer_order_item_substitution(
  p_order_item_id uuid,
  p_substitute_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  item_row public.order_items%rowtype;
  order_row public.orders%rowtype;
  original_product public.products%rowtype;
  substitute_product public.products%rowtype;
  existing_offer public.order_item_substitutions%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'seller'
  ) then
    raise exception 'A signed-in seller is required.';
  end if;

  select * into item_row
  from public.order_items
  where id = p_order_item_id
  for update;
  if not found then
    raise exception 'This order item is no longer available.';
  end if;

  select * into order_row
  from public.orders
  where id = item_row.order_id
  for update;
  if order_row.status not in ('pending', 'accepted', 'preparing')
    or (order_row.payment_method = 'monnify' and order_row.payment_status <> 'paid') then
    raise exception 'Substitutions can only be offered before the order is ready and after payment is verified.';
  end if;

  select * into original_product from public.products where id = item_row.product_id for update;
  select * into substitute_product from public.products where id = p_substitute_product_id for update;
  if not found
    or substitute_product.store_id <> original_product.store_id
    or substitute_product.id = original_product.id
    or substitute_product.unit <> original_product.unit
    or substitute_product.is_available is not true
    or substitute_product.stock_quantity < item_row.quantity
    or substitute_product.price <> item_row.unit_price then
    raise exception 'Choose an available product from your store with enough stock and the same price.';
  end if;

  if not exists (
    select 1 from public.stores
    where id = original_product.store_id and owner_id = auth.uid()
  ) then
    raise exception 'You can only substitute products in your own store.';
  end if;

  select * into existing_offer
  from public.order_item_substitutions
  where order_item_id = item_row.id
  for update;
  if found and existing_offer.status <> 'declined' then
    raise exception 'This order item already has an active or accepted substitution.';
  end if;

  update public.products
  set stock_quantity = stock_quantity - item_row.quantity,
      is_available = is_available and stock_quantity - item_row.quantity > 0,
      updated_at = now()
  where id = substitute_product.id;

  insert into public.order_item_substitutions (
    order_item_id, seller_id, substitute_product_id, status, created_at, responded_at
  ) values (
    item_row.id, auth.uid(), substitute_product.id, 'pending', now(), null
  )
  on conflict (order_item_id) do update
  set seller_id = excluded.seller_id,
      substitute_product_id = excluded.substitute_product_id,
      status = 'pending',
      created_at = now(),
      responded_at = null;
end;
$$;

create or replace function public.respond_to_order_item_substitution(
  p_order_item_id uuid,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  item_row public.order_items%rowtype;
  order_row public.orders%rowtype;
  offer_row public.order_item_substitutions%rowtype;
  original_product_id uuid;
begin
  if auth.uid() is null or p_accept is null then
    raise exception 'Sign in to respond to a substitution.';
  end if;

  select * into item_row
  from public.order_items
  where id = p_order_item_id
  for update;
  if not found then
    raise exception 'This order item is no longer available.';
  end if;
  select * into order_row from public.orders where id = item_row.order_id for update;
  if order_row.buyer_id <> auth.uid() or order_row.status not in ('pending', 'accepted', 'preparing') then
    raise exception 'This order is not awaiting a substitution decision.';
  end if;
  if order_row.payment_method = 'monnify' and order_row.payment_status <> 'paid' then
    raise exception 'Payment must be verified before responding to a substitution.';
  end if;

  select * into offer_row
  from public.order_item_substitutions
  where order_item_id = item_row.id and status = 'pending'
  for update;
  if not found then
    raise exception 'There is no pending substitution offer for this item.';
  end if;

  if p_accept then
    original_product_id := item_row.product_id;
    update public.order_items
    set product_id = offer_row.substitute_product_id
    where id = item_row.id;
    update public.products
    set stock_quantity = stock_quantity + item_row.quantity,
        updated_at = now()
    where id = original_product_id;
    update public.order_item_substitutions
    set status = 'accepted', responded_at = now()
    where order_item_id = item_row.id;
  else
    update public.products
    set stock_quantity = stock_quantity + item_row.quantity,
        updated_at = now()
    where id = offer_row.substitute_product_id;
    update public.order_item_substitutions
    set status = 'declined', responded_at = now()
    where order_item_id = item_row.id;
  end if;
end;
$$;

revoke all on function public.offer_order_item_substitution(uuid, uuid) from public, anon;
revoke all on function public.respond_to_order_item_substitution(uuid, boolean) from public, anon;
grant execute on function public.offer_order_item_substitution(uuid, uuid) to authenticated;
grant execute on function public.respond_to_order_item_substitution(uuid, boolean) to authenticated;

create table if not exists public.store_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  review text not null default '' check (char_length(review) <= 1000),
  created_at timestamptz not null default now(),
  unique (order_id, store_id)
);

alter table public.store_reviews enable row level security;
revoke all on public.store_reviews from anon, authenticated;
grant select on public.store_reviews to authenticated;

drop policy if exists "Buyers and store owners can view reviews" on public.store_reviews;
create policy "Buyers and store owners can view reviews"
  on public.store_reviews for select
  using (
    buyer_id = auth.uid()
    or exists (
      select 1 from public.stores
      where stores.id = store_reviews.store_id and stores.owner_id = auth.uid()
    )
    or public.is_admin()
  );

create or replace function public.submit_store_review(
  p_order_id uuid,
  p_store_id uuid,
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
  if auth.uid() is null or p_rating not between 1 and 5
    or char_length(coalesce(p_review, '')) > 1000 then
    raise exception 'Provide a rating from 1 to 5 and a review under 1000 characters.';
  end if;

  select * into order_row
  from public.orders
  where id = p_order_id and buyer_id = auth.uid()
  for update;
  if not found
    or order_row.status <> 'completed'
    or order_row.buyer_confirmed_at is null
    or (order_row.payment_method = 'monnify' and order_row.payment_status <> 'paid') then
    raise exception 'You can review a store after confirming receipt of a completed order.';
  end if;

  if not exists (
    select 1
    from public.order_items item
    join public.products product on product.id = item.product_id
    where item.order_id = p_order_id and product.store_id = p_store_id
  ) then
    raise exception 'This store is not part of the selected order.';
  end if;

  insert into public.store_reviews (order_id, store_id, buyer_id, rating, review)
  values (p_order_id, p_store_id, auth.uid(), p_rating, trim(coalesce(p_review, '')))
  on conflict (order_id, store_id) do update
  set rating = excluded.rating, review = excluded.review, created_at = now();
end;
$$;

revoke all on function public.submit_store_review(uuid, uuid, smallint, text) from public, anon;
grant execute on function public.submit_store_review(uuid, uuid, smallint, text) to authenticated;

create table if not exists public.order_issues (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  issue_type text not null check (issue_type in ('missing_item', 'damaged_item', 'late_delivery', 'payment', 'other')),
  description text not null check (char_length(description) between 5 and 2000),
  status text not null default 'open' check (status in ('open', 'in_review', 'resolved')),
  admin_note text not null default '' check (char_length(admin_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_issues_order_id_created_at_idx
  on public.order_issues(order_id, created_at desc);

alter table public.order_issues enable row level security;
revoke all on public.order_issues from anon, authenticated;
grant select on public.order_issues to authenticated;

drop policy if exists "Buyers and admins can view order issues" on public.order_issues;
create policy "Buyers and admins can view order issues"
  on public.order_issues for select
  using (buyer_id = auth.uid() or public.is_admin());

create or replace function public.submit_order_issue(
  p_order_id uuid,
  p_issue_type text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  new_issue_id uuid;
begin
  if auth.uid() is null
    or p_issue_type not in ('missing_item', 'damaged_item', 'late_delivery', 'payment', 'other')
    or char_length(trim(coalesce(p_description, ''))) not between 5 and 2000 then
    raise exception 'Choose an issue type and provide a description between 5 and 2000 characters.';
  end if;
  if not exists (
    select 1 from public.orders
    where id = p_order_id and buyer_id = auth.uid() and status <> 'cancelled'
  ) then
    raise exception 'Only the buyer can report an issue with this order.';
  end if;

  insert into public.order_issues (order_id, buyer_id, issue_type, description)
  values (p_order_id, auth.uid(), p_issue_type, trim(p_description))
  returning id into new_issue_id;
  return new_issue_id;
end;
$$;

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
  where id = p_issue_id;
  if not found then
    raise exception 'This issue report no longer exists.';
  end if;
end;
$$;

revoke all on function public.submit_order_issue(uuid, text, text) from public, anon;
revoke all on function public.update_order_issue(uuid, text, text) from public, anon;
grant execute on function public.submit_order_issue(uuid, text, text) to authenticated;
grant execute on function public.update_order_issue(uuid, text, text) to authenticated;

commit;
