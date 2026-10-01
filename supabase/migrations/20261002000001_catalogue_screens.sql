-- What the catalogue screens need from the database.

-- ---------------------------------------------------------------------------
-- Shareable product links: black-satin-wrap-dress-dr-001
--
-- Set once, when the design is created, and never changed by a rename, so a link
-- pasted into an Instagram DM keeps working. The category and model number on the
-- end make it unique without a retry loop.

create function private.assign_slug() returns trigger
language plpgsql as $$
declare
  cat_code text;
  base     text;
begin
  if new.slug is null then
    select lower(code) into cat_code from public.categories where id = new.category_id;
    base := trim(both '-' from left(regexp_replace(lower(new.name), '[^a-z0-9]+', '-', 'g'), 60));
    if base = '' then
      base := 'design';
    end if;
    new.slug := base || '-' || cat_code || '-' || new.model_code;
  end if;
  return new;
end $$;

-- Fires after products_assign_model_code (triggers run in name order), which supplies model_code.
create trigger products_assign_slug
  before insert on public.products
  for each row execute function private.assign_slug();

-- ---------------------------------------------------------------------------
-- Removing a variant that was never used.
--
-- Its empty stock row goes with it. A variant with any history still can't be
-- deleted: the ledger, orders and purchases all reference it.

alter table public.stock
  drop constraint stock_variant_id_fkey,
  add constraint stock_variant_id_fkey foreign key (variant_id) references public.variants (id) on delete cascade;

create function private.guard_variant_delete() returns trigger
language plpgsql as $$
begin
  if old.locked then
    raise exception 'variant_locked'
      using detail = format('SKU %s has transaction history and cannot be deleted; mark it inactive instead', old.sku);
  end if;
  return old;
end $$;

create trigger variants_guard_delete
  before delete on public.variants
  for each row execute function private.guard_variant_delete();

-- Staff create variants with an identity and a price. Cost is maintained by
-- receiving purchases and the lock by the stock engine, so neither can be set here.
revoke insert on public.variants from authenticated;
grant insert (product_id, color_id, size_id, sku, barcode, price_eur, compare_at_price_eur, active)
  on public.variants to authenticated;

-- ---------------------------------------------------------------------------
-- Codes baked into SKUs can't change once something uses them.

create function private.guard_category_code() returns trigger
language plpgsql as $$
begin
  if new.code is distinct from old.code and exists (select 1 from public.products where category_id = old.id) then
    raise exception 'code_in_use' using detail = format('category %s has designs; its code is part of their SKUs', old.code);
  end if;
  return new;
end $$;

create trigger categories_guard_code
  before update on public.categories
  for each row execute function private.guard_category_code();

create function private.guard_color_code() returns trigger
language plpgsql as $$
begin
  if new.code is distinct from old.code and exists (select 1 from public.variants where color_id = old.id) then
    raise exception 'code_in_use' using detail = format('colour %s is used by variants; its code is part of their SKUs', old.code);
  end if;
  return new;
end $$;

create trigger colors_guard_code
  before update on public.colors
  for each row execute function private.guard_color_code();

create function private.guard_size_code() returns trigger
language plpgsql as $$
begin
  if new.code is distinct from old.code and exists (select 1 from public.variants where size_id = old.id) then
    raise exception 'code_in_use' using detail = format('size %s is used by variants; its code is part of their SKUs', old.code);
  end if;
  return new;
end $$;

create trigger sizes_guard_code
  before update on public.sizes
  for each row execute function private.guard_size_code();

-- ---------------------------------------------------------------------------
-- Photos: one primary per design, and a stable order.

-- Deleting the primary photo promotes the next one, so a design never silently
-- loses its cover image while it still has photos.
create function private.promote_next_image() returns trigger
language plpgsql as $$
begin
  if old.is_primary then
    update public.product_images
       set is_primary = true
     where id = (select id from public.product_images where product_id = old.product_id order by sort_order, id limit 1);
  end if;
  return old;
end $$;

create trigger product_images_promote
  after delete on public.product_images
  for each row execute function private.promote_next_image();

create function public.set_primary_image(p_image_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  pid bigint;
begin
  if not private.is_staff() then
    raise exception 'not_authorized';
  end if;
  select product_id into pid from public.product_images where id = p_image_id;
  if not found then
    raise exception 'not_found' using detail = format('image %s', p_image_id);
  end if;
  update public.product_images set is_primary = false where product_id = pid and is_primary;
  update public.product_images set is_primary = true where id = p_image_id;
end $$;

-- Sets the display order to the order of the ids given. Ids that don't belong to
-- the design are ignored.
create function public.reorder_images(p_product_id bigint, p_ids bigint[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_staff() then
    raise exception 'not_authorized';
  end if;
  update public.product_images pi
     set sort_order = o.ord
    from unnest(p_ids) with ordinality as o(image_id, ord)
   where pi.id = o.image_id and pi.product_id = p_product_id;
end $$;

revoke execute on function public.set_primary_image(bigint) from public, anon;
revoke execute on function public.reorder_images(bigint, bigint[]) from public, anon;
grant execute on function public.set_primary_image(bigint) to authenticated;
grant execute on function public.reorder_images(bigint, bigint[]) to authenticated;

-- The first photo of a design becomes its cover.
create function private.first_image_is_primary() returns trigger
language plpgsql as $$
begin
  new.is_primary := not exists (select 1 from public.product_images where product_id = new.product_id and is_primary);
  return new;
end $$;

create trigger product_images_first_primary
  before insert on public.product_images
  for each row execute function private.first_image_is_primary();
