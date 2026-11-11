begin;

create extension if not exists pg_trgm;

do $$
declare
  trgm_schema text;
begin
  select n.nspname
  into trgm_schema
  from pg_extension as e
  join pg_namespace as n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  execute format(
    'create index if not exists stores_market_area_trgm_idx on public.stores using gin (market_area %I.gin_trgm_ops)',
    trgm_schema
  );
  execute format(
    'create index if not exists stores_name_trgm_idx on public.stores using gin (name %I.gin_trgm_ops)',
    trgm_schema
  );
  execute format(
    'create index if not exists products_name_trgm_idx on public.products using gin (name %I.gin_trgm_ops)',
    trgm_schema
  );
  execute format(
    'create index if not exists products_description_trgm_idx on public.products using gin (description %I.gin_trgm_ops)',
    trgm_schema
  );
end;
$$;

create index if not exists products_marketplace_available_created_idx
  on public.products (created_at desc, id desc)
  where is_available = true;

create index if not exists products_marketplace_store_created_idx
  on public.products (store_id, created_at desc, id desc)
  where is_available = true;

create or replace function public.get_nearby_marketplace_products(
  p_area text,
  p_search text default '',
  p_category text default 'All',
  p_verified_only boolean default false,
  p_limit integer default 25,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null
)
returns table (
  id uuid,
  store_id uuid,
  name text,
  price numeric,
  unit text,
  category text,
  image_url text,
  description text,
  stock_quantity numeric,
  variant_options jsonb,
  store_name text,
  store_category text,
  store_market_area text,
  store_verified boolean,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with filtered_products as (
    select
      product.id,
      product.store_id,
      product.name,
      product.price,
      product.unit,
      product.category,
      product.image_url,
      product.description,
      product.stock_quantity,
      product.variant_options,
      store.name as store_name,
      store.category as store_category,
      store.market_area as store_market_area,
      coalesce(verification.status = 'verified', false) as store_verified,
      product.created_at
    from public.products as product
    join public.stores as store on store.id = product.store_id
    left join public.public_store_verification_status as verification
      on verification.store_id = store.id
    where product.is_available = true
      and (
        product.stock_quantity > 0
        or exists (
          select 1
          from jsonb_array_elements(product.variant_options) as variant(value)
          where coalesce((variant.value ->> 'stock')::numeric, 0) > 0
        )
      )
      and nullif(trim(coalesce(p_area, '')), '') is not null
      and exists (
        select 1
        from regexp_split_to_table(p_area, '[,;·]+') as requested_area(value)
        where nullif(trim(requested_area.value), '') is not null
          and store.market_area ilike (
            '%' ||
            replace(replace(replace(trim(requested_area.value), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') ||
            '%'
          ) escape E'\\'
      )
      and (
        nullif(trim(coalesce(p_search, '')), '') is null
        or product.name ilike (
          '%' || replace(replace(replace(trim(p_search), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
        ) escape E'\\'
        or store.name ilike (
          '%' || replace(replace(replace(trim(p_search), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
        ) escape E'\\'
        or coalesce(product.description, '') ilike (
          '%' || replace(replace(replace(trim(p_search), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
        ) escape E'\\'
      )
      and (
        coalesce(trim(p_category), 'All') = 'All'
        or (
          lower(trim(p_category)) = 'food'
          and lower(trim(product.category)) = any (array[
            'vegetables', 'fruits', 'tubers & roots', 'rice & grains', 'beans & legumes',
            'swallow flours', 'noodles & pasta', 'cooking oils', 'herbs & spices',
            'beef & goat', 'poultry & eggs', 'seafood', 'bread & bakery',
            'dairy & alternatives', 'seasonings & spices', 'cereals & oats', 'drinks',
            'baby food', 'rice dishes', 'soups & swallows', 'protein add-ons',
            'snacks & pastries', 'grills & platters', 'salads', 'platters & combos',
            'other produce', 'pantry', 'produce', 'packaged goods'
          ])
        )
        or (
          lower(trim(p_category)) = 'packaged goods'
          and lower(trim(product.category)) = any (array[
            'rice & grains', 'beans & legumes', 'swallow flours', 'noodles & pasta',
            'cooking oils', 'herbs & spices', 'seasonings & spices', 'cereals & oats',
            'drinks', 'dairy & alternatives', 'baby food', 'pantry', 'packaged goods'
          ])
        )
        or (
          lower(trim(p_category)) = 'restaurants'
          and concat_ws(' ', store.category, product.category) ~* '(restaurant|cafe|eatery|food vendor)'
        )
        or (
          lower(trim(p_category)) = 'kitchen utensils'
          and product.category ~* '(kitchen|utensil|cookware|kitchenware)'
        )
        or (
          lower(trim(p_category)) not in ('food', 'packaged goods', 'restaurants', 'kitchen utensils')
          and lower(trim(product.category)) = lower(trim(p_category))
        )
      )
      and (not coalesce(p_verified_only, false) or verification.status = 'verified')
      and (
        (p_after_created_at is null and p_after_id is null)
        or (
          p_after_created_at is not null
          and p_after_id is not null
          and (product.created_at, product.id) < (p_after_created_at, p_after_id)
        )
      )
  )
  select
    filtered_products.id,
    filtered_products.store_id,
    filtered_products.name,
    filtered_products.price,
    filtered_products.unit,
    filtered_products.category,
    filtered_products.image_url,
    filtered_products.description,
    filtered_products.stock_quantity,
    filtered_products.variant_options,
    filtered_products.store_name,
    filtered_products.store_category,
    filtered_products.store_market_area,
    filtered_products.store_verified,
    filtered_products.created_at
  from filtered_products
  order by filtered_products.created_at desc, filtered_products.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 49);
$$;

revoke all on function public.get_nearby_marketplace_products(text, text, text, boolean, integer, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.get_nearby_marketplace_products(text, text, text, boolean, integer, timestamptz, uuid)
  to anon, authenticated;

commit;
