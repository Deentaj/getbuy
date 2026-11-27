begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'profile-photos';

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'verification-documents';

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'delivery-proofs';

drop policy if exists "Sellers can upload product images" on storage.objects;
drop policy if exists "Sellers can update their product images" on storage.objects;
drop policy if exists "Sellers can delete their product images" on storage.objects;
create policy "Sellers can delete their product images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.stores
      where owner_id = auth.uid()
    )
  );

drop policy if exists "Users can upload their own profile photos" on storage.objects;
drop policy if exists "Users can update their own profile photos" on storage.objects;

drop policy if exists "Verification applicants can upload their documents" on storage.objects;

drop policy if exists "Assigned riders can upload delivery proof" on storage.objects;

commit;
