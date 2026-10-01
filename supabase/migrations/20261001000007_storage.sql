-- Product photos. Public bucket: the shop serves them by URL; only staff upload.
-- Skipped when there's no Supabase storage schema (e.g. the local test harness).

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present; skipping bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('product-images', 'product-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

  execute $p$
    create policy "staff upload product images" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'product-images' and private.is_staff())
  $p$;
  execute $p$
    create policy "staff update product images" on storage.objects
      for update to authenticated
      using (bucket_id = 'product-images' and private.is_staff())
  $p$;
  execute $p$
    create policy "staff delete product images" on storage.objects
      for delete to authenticated
      using (bucket_id = 'product-images' and private.is_staff())
  $p$;
end $$;
