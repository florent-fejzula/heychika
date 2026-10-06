-- Adding stock in one step.
--
-- Before: make a design, add its colours and sizes, set prices, then open a buying
-- trip, pick the design and fill in quantities, then receive. Five screens for one
-- bag of clothes. Now one form does it: what it is, which colours and sizes, how
-- many of each, what was paid, and the selling price.
--
-- And the clothes arrive with barcodes on their tags already. Rather than print new
-- stickers, each size takes the barcode from its tag: scan it once and it's linked.

-- ---------------------------------------------------------------------------
-- One item onto a trip, or straight into stock
--
--   p_purchase_id  a draft buying trip, or null: then the items go straight on the
--                  shelf, through a trip of their own named "Added by hand, <date>"
--                  that is received at once (so cost and history work as always)
--   p_item         {
--                    product_id    an existing design, or null for a new one
--                    category_id   new design only
--                    name          new design only
--                    show_online   new design only (default true)
--                    price_eur     the selling price, for every size listed
--                    unit_price    what was paid per item, in the trip's currency
--                    lines         [{color_id, size_id, qty}]
--                  }
--
-- Sizes the design doesn't have yet are created. The design's lines on the trip are
-- replaced by what's sent, so the same form adds and corrects: a size sent with
-- qty 0 comes off the trip.

create function public.save_trip_item(p_purchase_id bigint, p_item jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_purchase    public.purchases;
  v_direct      boolean := p_purchase_id is null;
  v_product_id  bigint := nullif(p_item->>'product_id', '')::bigint;
  v_name        text := trim(coalesce(p_item->>'name', ''));
  v_category    bigint := nullif(p_item->>'category_id', '')::bigint;
  v_price       numeric;
  v_paid        numeric;
  v_line        record;
  v_variant_id  bigint;
  v_kept        bigint[] := '{}';
begin
  perform private.require_staff();

  begin
    v_price := (p_item->>'price_eur')::numeric;
    v_paid := (p_item->>'unit_price')::numeric;
  exception when invalid_text_representation then
    raise exception 'invalid_item' using detail = 'price';
  end;
  if v_price is null or v_price < 0 then
    raise exception 'invalid_item' using detail = 'price';
  end if;
  if v_paid is null or v_paid < 0 then
    raise exception 'invalid_item' using detail = 'unit_price';
  end if;
  if jsonb_typeof(p_item->'lines') is distinct from 'array'
     or not exists (
       select 1 from jsonb_to_recordset(p_item->'lines') x(color_id bigint, size_id bigint, qty int) where x.qty > 0
     ) then
    raise exception 'invalid_item' using detail = 'lines';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_item->'lines') x(color_id bigint, size_id bigint, qty int)
     where x.color_id is null or x.size_id is null or x.qty is null or x.qty < 0 or x.qty > 10000
  ) then
    raise exception 'invalid_item' using detail = 'lines';
  end if;

  -- The trip
  if v_direct then
    insert into public.purchases (reference, purchase_date, currency, currency_per_eur, extra_costs_eur)
    values ('Added by hand, ' || to_char(current_date, 'FMDD Mon YYYY'), current_date, 'EUR', 1, 0)
    returning * into v_purchase;
  else
    select * into v_purchase from public.purchases where id = p_purchase_id for update;
    if not found then
      raise exception 'not_found' using detail = format('buying trip %s', p_purchase_id);
    end if;
    if v_purchase.status = 'received' then
      raise exception 'purchase_received' using detail = format('%s has been received and cannot be edited', v_purchase.reference);
    end if;
  end if;

  -- The design
  if v_product_id is null then
    if v_name = '' then
      raise exception 'invalid_item' using detail = 'name';
    end if;
    if v_category is null or not exists (select 1 from public.categories where id = v_category) then
      raise exception 'invalid_item' using detail = 'category';
    end if;
    insert into public.products (category_id, name, status, show_online)
    values (v_category, v_name, 'active', coalesce((p_item->>'show_online')::boolean, true))
    returning id into v_product_id;
  elsif not exists (select 1 from public.products where id = v_product_id) then
    raise exception 'not_found' using detail = format('design %s', v_product_id);
  end if;

  -- Its sizes, and their quantities on the trip
  for v_line in
    select x.color_id, x.size_id, sum(x.qty)::int as qty
      from jsonb_to_recordset(p_item->'lines') x(color_id bigint, size_id bigint, qty int)
     group by x.color_id, x.size_id
     order by x.color_id, x.size_id
  loop
    select id into v_variant_id
      from public.variants
     where product_id = v_product_id and color_id = v_line.color_id and size_id = v_line.size_id;

    if v_line.qty = 0 then
      continue;
    end if;

    if v_variant_id is null then
      insert into public.variants (product_id, color_id, size_id, price_eur)
      values (v_product_id, v_line.color_id, v_line.size_id, v_price)
      returning id into v_variant_id;
    else
      update public.variants set price_eur = v_price, active = true
       where id = v_variant_id and (price_eur is distinct from v_price or not active);
    end if;

    insert into public.purchase_lines (purchase_id, variant_id, qty, unit_price)
    values (v_purchase.id, v_variant_id, v_line.qty, v_paid)
    on conflict (purchase_id, variant_id) do update set qty = excluded.qty, unit_price = excluded.unit_price;

    v_kept := v_kept || v_variant_id;
  end loop;

  delete from public.purchase_lines l
   using public.variants v
   where l.purchase_id = v_purchase.id
     and v.id = l.variant_id
     and v.product_id = v_product_id
     and not (l.variant_id = any (v_kept));

  if v_direct then
    perform public.receive_purchase(v_purchase.id);
  end if;

  return jsonb_build_object('product_id', v_product_id, 'purchase_id', v_purchase.id, 'variant_ids', to_jsonb(v_kept));
end $$;

revoke execute on function public.save_trip_item(bigint, jsonb) from public, anon;
grant execute on function public.save_trip_item(bigint, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The barcode on the tag
--
-- A size starts with its SKU as its barcode. Scanning the tag's own barcode links it
-- to that size, so packing and looking things up work by scanning the tag. Allowed
-- even after the size has history (it only changes how it's found, not what it is),
-- and every change is kept in variant_code_changes. null puts it back to the SKU.

create function public.link_barcode(p_variant_id bigint, p_barcode text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v       public.variants;
  v_code  text := nullif(trim(coalesce(p_barcode, '')), '');
  v_other text;
begin
  perform private.require_staff();

  select * into v from public.variants where id = p_variant_id for update;
  if not found then
    raise exception 'not_found' using detail = format('size %s', p_variant_id);
  end if;

  if p_barcode is not null and (v_code is null or length(v_code) > 64 or v_code ~ '\s') then
    raise exception 'invalid_barcode';
  end if;
  v_code := coalesce(v_code, v.sku);
  if v_code = v.barcode then
    return;
  end if;

  -- One code, one size: anything else and a scan couldn't tell which it is.
  select sku into v_other
    from public.variants
   where id <> v.id and (barcode = v_code or sku = v_code)
   limit 1;
  if v_other is not null then
    raise exception 'barcode_in_use' using detail = v_other;
  end if;

  insert into public.variant_code_changes (variant_id, old_sku, new_sku, old_barcode, new_barcode, reason)
  values (v.id, v.sku, v.sku, v.barcode, v_code,
          case when v_code = v.sku then 'Barcode put back to the SKU' else 'Linked the barcode on its tag' end);

  perform set_config('heychika.code_correction', 'on', true);
  update public.variants set barcode = v_code where id = v.id;
  perform set_config('heychika.code_correction', 'off', true);
end $$;

revoke execute on function public.link_barcode(bigint, text) from public, anon;
grant execute on function public.link_barcode(bigint, text) to authenticated;
