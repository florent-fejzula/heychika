-- Demo products, so the whole flow can be tried before real stock is entered:
-- browse, add to bag, order, then see the order in the admin.
--
-- Run once in the Supabase SQL Editor, AFTER the migrations and seed.sql, and after
-- the owners' profiles exist (it receives stock the way a real buying trip does, as
-- the first owner). Safe to run twice: it stops if the demo is already there.
--
-- Every demo design has a link ending that starts with "demo-", and the buying trip
-- is called "DEMO ...". remove-demo-data.sql uses those to take it all out again.
-- Do that before real launch: demo stock and costs would otherwise count in the
-- numbers on the Today page.
--
-- No photos: the shop shows a letter in place of a missing photo. Add photos to a
-- design in the admin to see how that looks.

do $demo$
declare
  v_owner     uuid;
  v_trip      bigint;
  d           jsonb;
  c           text;
  s           text;
  v_product   bigint;
  v_variant   bigint;
  v_n         int := 0;
  v_qty       int;
  v_designs   jsonb := $json$[
    {"slug":"demo-satin-wrap-dress","cat":"DR","name":"Satin wrap dress","price":39,"was":49,"featured":true,
     "desc":"Soft satin with a tie waist. Falls just below the knee.","material":"95% polyester, 5% elastane",
     "colors":["BLK","BRD","CRM"],"sizes":["XS","S","M","L"]},
    {"slug":"demo-linen-midi-dress","cat":"DR","name":"Linen midi dress","price":45,
     "desc":"Relaxed linen blend with side pockets.","material":"55% linen, 45% viscose",
     "colors":["BEI","OLV"],"sizes":["S","M","L","XL"]},
    {"slug":"demo-floral-summer-dress","cat":"DR","name":"Floral summer dress","price":35,"featured":true,
     "desc":"Light and flowy, with a V neck.","material":"100% viscose",
     "colors":["PNK"],"sizes":["S","M","L"],"sold_out":true},
    {"slug":"demo-ribbed-knit-top","cat":"TP","name":"Ribbed knit top","price":19,
     "desc":"Fitted, stretchy, goes with everything.","material":"Cotton blend",
     "colors":["BLK","WHT","BRN","NVY"],"sizes":["XS","S","M","L"]},
    {"slug":"demo-oversized-shirt","cat":"SH","name":"Oversized poplin shirt","price":29,
     "desc":"Crisp cotton, roomy fit.","material":"100% cotton",
     "colors":["WHT","BLU"],"sizes":["S","M","L"]},
    {"slug":"demo-basic-tee","cat":"TS","name":"Everyday tee","price":12,
     "desc":"Heavyweight cotton, true to size.","material":"100% cotton",
     "colors":["WHT","BLK","GRY","PNK","GRN"],"sizes":["S","M","L","XL"]},
    {"slug":"demo-wide-leg-trousers","cat":"PN","name":"Wide-leg trousers","price":42,
     "desc":"High waist, flowing leg.","material":"Polyester crepe",
     "colors":["BLK","BEI"],"sizes":["XS","S","M","L"]},
    {"slug":"demo-straight-jeans","cat":"JN","name":"High-waist straight jeans","price":48,"featured":true,
     "desc":"Classic mid-blue wash.","material":"98% cotton, 2% elastane",
     "colors":["BLU"],"sizes":["36","38","40","42","44"]},
    {"slug":"demo-pleated-midi-skirt","cat":"SK","name":"Pleated midi skirt","price":32,
     "desc":"Elastic waist, moves beautifully.","material":"Polyester",
     "colors":["BLK","GLD","OLV"],"sizes":["S","M","L"]},
    {"slug":"demo-cropped-blazer","cat":"JK","name":"Cropped blazer","price":59,"was":75,
     "desc":"Structured shoulders, one button.","material":"Polyester blend, lined",
     "colors":["BLK","CRM"],"sizes":["S","M","L"]},
    {"slug":"demo-wool-coat","cat":"CT","name":"Long wool-blend coat","price":99,
     "desc":"Warm and tailored. Double breasted.","material":"60% wool, 40% polyester",
     "colors":["BRN","GRY"],"sizes":["S","M","L","XL"]},
    {"slug":"demo-matching-set","cat":"ST","name":"Matching set: top and skirt","price":55,
     "desc":"Two pieces, sold together.","material":"Ribbed jersey",
     "colors":["BRD"],"sizes":["OS"]},
    {"slug":"demo-draft-blouse","cat":"TP","name":"Draft blouse (hidden)","price":25,"draft":true,
     "desc":"A design not yet shown in the shop. Customers can't see it.","material":null,
     "colors":["WHT"],"sizes":["S","M"]}
  ]$json$::jsonb;
begin
  if exists (select 1 from public.products where slug like 'demo-%') then
    raise notice 'The demo products are already there; nothing was changed.';
    return;
  end if;

  select id into v_owner from public.profiles order by created_at limit 1;
  if v_owner is null then
    raise exception 'Add the owners'' profiles first (README step 3); the demo receives its stock as an owner.';
  end if;

  -- ---------------------------------------------------------- designs and sizes
  for d in select * from jsonb_array_elements(v_designs) loop
    insert into public.products (category_id, name, slug, description, material, status, show_online, featured)
    values (
      (select id from public.categories where code = d ->> 'cat'),
      d ->> 'name', d ->> 'slug', d ->> 'desc', d ->> 'material',
      case when d ? 'draft' then 'draft'::public.product_status else 'active'::public.product_status end,
      not (d ? 'draft'),
      coalesce((d ->> 'featured')::boolean, false)
    ) returning id into v_product;

    for c in select jsonb_array_elements_text(d -> 'colors') loop
      for s in select jsonb_array_elements_text(d -> 'sizes') loop
        insert into public.variants (product_id, color_id, size_id, price_eur, compare_at_price_eur)
        values (
          v_product,
          (select id from public.colors where code = c),
          (select id from public.sizes where code = s),
          (d ->> 'price')::numeric,
          (d ->> 'was')::numeric
        );
      end loop;
    end loop;
  end loop;

  -- ---------------------------------------------------------- a buying trip, received for real
  -- Some sizes get none (sold out), some one or two (the "only 2 left" label),
  -- the rest a handful. Cost is 45% of the price plus an even share of EUR 60 trip costs.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into public.purchases (reference, supplier_name, currency, currency_per_eur, extra_costs_eur, allocation_method, notes)
  values ('DEMO trip (delete me)', 'Demo supplier', 'EUR', 1, 60, 'by_quantity', 'Made by demo-data.sql; remove with remove-demo-data.sql')
  returning id into v_trip;

  for v_variant, v_qty in
    select v.id,
           case when p.slug = 'demo-floral-summer-dress' then 0
                else (array[0, 1, 2, 4, 5, 8, 3, 6])[1 + (v.id % 8)::int] end
      from public.variants v
      join public.products p on p.id = v.product_id
     where p.slug like 'demo-%'
     order by v.id
  loop
    if v_qty > 0 then
      insert into public.purchase_lines (purchase_id, variant_id, qty, unit_price)
      select v_trip, v.id, v_qty, round(v.price_eur * 0.45, 2) from public.variants v where v.id = v_variant;
      v_n := v_n + v_qty;
    end if;
  end loop;

  perform public.receive_purchase(v_trip);

  raise notice 'Demo ready: % designs, % items received. Open the shop to see them.',
    jsonb_array_length(v_designs), v_n;
end
$demo$;
