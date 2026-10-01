-- Who can see and change what.
--
-- Two kinds of caller:
--   anon           the public shop. Sees active, online products and nothing else.
--                  Never sees cost prices, markup, customers, orders or the ledger.
--   authenticated  only matters if the user is staff (has a profile row). A logged-in
--                  stranger without a profile gets nothing.
--
-- Stock, the ledger and orders are never written directly by clients: they change
-- only through functions, which keep balances, ledger and status history in step.
--
-- Supabase grants everything to anon and authenticated by default and relies on RLS.
-- Here we revoke it all and grant back only what each role needs, so a missing
-- policy fails closed. Later migrations must do their own grants.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Policies call private.is_staff(), so staff need to reach that one function.
-- Everything else in private (the stock engine above all) stays out of reach.
revoke execute on all functions in schema private from public;
grant usage on schema private to authenticated;
grant execute on function private.is_staff() to authenticated;

alter table public.categories            enable row level security;
alter table public.colors                enable row level security;
alter table public.sizes                 enable row level security;
alter table public.products              enable row level security;
alter table public.variants              enable row level security;
alter table public.variant_code_changes  enable row level security;
alter table public.product_images        enable row level security;
alter table public.stock                 enable row level security;
alter table public.stock_movements       enable row level security;
alter table public.purchases             enable row level security;
alter table public.purchase_lines        enable row level security;
alter table public.customers             enable row level security;
alter table public.orders                enable row level security;
alter table public.order_lines           enable row level security;
alter table public.order_status_history  enable row level security;
alter table public.returns               enable row level security;
alter table public.return_lines          enable row level security;
alter table public.profiles              enable row level security;
alter table public.settings              enable row level security;
alter table public.delivery_zones        enable row level security;

-- ---------------------------------------------------------------------------
-- The shop (anon)

grant select on public.categories, public.colors, public.sizes, public.products,
                public.product_images, public.delivery_zones
  to anon;

-- Column grants: the shop must never be able to read what they paid for stock.
grant select (id, product_id, color_id, size_id, sku, price_eur, compare_at_price_eur, active)
  on public.variants to anon;
grant select (variant_id, qty_available) on public.stock to anon;
grant select (id, store_name, contact_phone, contact_email, instagram_url, tiktok_url, facebook_url,
              mkd_per_eur, all_per_eur, mkd_rounding, all_rounding)
  on public.settings to anon;

create policy shop_categories on public.categories for select to anon using (active);
create policy shop_colors     on public.colors     for select to anon using (active);
create policy shop_sizes      on public.sizes      for select to anon using (active);
create policy shop_zones      on public.delivery_zones for select to anon using (active);
create policy shop_settings   on public.settings   for select to anon using (true);

create policy shop_products on public.products for select to anon
  using (status = 'active' and show_online);

create policy shop_variants on public.variants for select to anon
  using (active and exists (
    select 1 from public.products p
     where p.id = product_id and p.status = 'active' and p.show_online));

create policy shop_images on public.product_images for select to anon
  using (exists (
    select 1 from public.products p
     where p.id = product_id and p.status = 'active' and p.show_online));

create policy shop_stock on public.stock for select to anon
  using (exists (
    select 1 from public.variants v
      join public.products p on p.id = v.product_id
     where v.id = variant_id and v.active and p.status = 'active' and p.show_online));

grant execute on function public.local_price(numeric, public.currency_code) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Staff (authenticated + profile row)

-- Catalogue, purchasing, customers, settings: full read/write.
grant select, insert, update, delete on
  public.categories, public.colors, public.sizes, public.products, public.product_images,
  public.purchases, public.purchase_lines, public.customers, public.delivery_zones
  to authenticated;

-- Variants: everything except cost (maintained by receiving) and the lock flag.
grant select, insert, delete on public.variants to authenticated;
grant update (product_id, color_id, size_id, sku, barcode, price_eur, compare_at_price_eur, active)
  on public.variants to authenticated;

-- Stock: read, plus the low-stock threshold. Quantities move only via functions.
grant select on public.stock to authenticated;
grant update (min_stock) on public.stock to authenticated;

-- Settings: read and edit, but the row can't be added or removed.
grant select, update on public.settings to authenticated;

-- History and orders: read-only until the order functions exist.
grant select on
  public.stock_movements, public.variant_code_changes,
  public.orders, public.order_lines, public.order_status_history,
  public.returns, public.return_lines, public.profiles
  to authenticated;

create policy staff_all on public.categories      for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.colors          for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.sizes           for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.products        for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.variants        for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.product_images  for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.stock           for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.purchases       for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.purchase_lines  for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.customers       for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.settings        for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.delivery_zones  for all to authenticated using (private.is_staff()) with check (private.is_staff());

create policy staff_read on public.stock_movements      for select to authenticated using (private.is_staff());
create policy staff_read on public.variant_code_changes for select to authenticated using (private.is_staff());
create policy staff_read on public.orders               for select to authenticated using (private.is_staff());
create policy staff_read on public.order_lines          for select to authenticated using (private.is_staff());
create policy staff_read on public.order_status_history for select to authenticated using (private.is_staff());
create policy staff_read on public.returns              for select to authenticated using (private.is_staff());
create policy staff_read on public.return_lines         for select to authenticated using (private.is_staff());
create policy staff_read on public.profiles             for select to authenticated using (private.is_staff());

-- ---------------------------------------------------------------------------
-- Staff functions

grant execute on function public.receive_purchase(bigint) to authenticated;

-- Manual stock changes: count corrections, damage found on the shelf, disposal.
-- Order and purchase movements are not available here; they come from their own flows.
create function public.record_stock_change(
  p_variant_id  bigint,
  p_type        public.movement_type,
  p_qty         int,
  p_note        text
) returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_staff() then
    raise exception 'not_authorized';
  end if;
  if p_type not in ('adjust', 'mark_damaged', 'writeoff') then
    raise exception 'invalid_stock_movement'
      using detail = format('%s happens through orders, purchases or returns, not by hand', p_type);
  end if;
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'invalid_stock_movement' using detail = 'a manual stock change needs a note saying why';
  end if;
  return private.apply_stock_movement(p_variant_id, p_type, p_qty, 'adjustment', null, null, p_note);
end $$;

revoke execute on function public.record_stock_change(bigint, public.movement_type, int, text) from public, anon;
grant execute on function public.record_stock_change(bigint, public.movement_type, int, text) to authenticated;

-- SKU / barcode correction on a locked variant. Rare and deliberate: it needs a
-- reason, and the old values are kept.
create function public.correct_variant_codes(
  p_variant_id   bigint,
  p_new_sku      text,
  p_new_barcode  text,
  p_reason       text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.variants;
begin
  if not private.is_staff() then
    raise exception 'not_authorized';
  end if;
  select * into v from public.variants where id = p_variant_id for update;
  if not found then
    raise exception 'not_found' using detail = format('variant %s', p_variant_id);
  end if;

  insert into public.variant_code_changes (variant_id, old_sku, new_sku, old_barcode, new_barcode, reason)
  values (v.id, v.sku, p_new_sku, v.barcode, p_new_barcode, p_reason);

  perform set_config('heychika.code_correction', 'on', true);
  update public.variants set sku = p_new_sku, barcode = p_new_barcode where id = p_variant_id;
  perform set_config('heychika.code_correction', 'off', true);
end $$;

revoke execute on function public.correct_variant_codes(bigint, text, text, text) from public, anon;
grant execute on function public.correct_variant_codes(bigint, text, text, text) to authenticated;
