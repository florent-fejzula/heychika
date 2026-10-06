-- Albanian names for categories, colours and sizes.
--
-- The app's own words are in web/src/i18n; these lists are typed by the owners,
-- so each row carries its Albanian name next to the English one. The shop shows
-- it when a visitor reads in Albanian, and falls back to the English name when
-- it's empty. Codes, SKUs, labels and links keep using the English name.

alter table public.categories add column name_sq text;
alter table public.colors     add column name_sq text;
alter table public.sizes      add column label_sq text;

-- The lists as seeded. A row she has already renamed is left for her to fill in.
update public.categories c
   set name_sq = v.sq
  from (values
    ('DR', 'Dresses',    'Fustane'),
    ('TP', 'Tops',       'Bluza'),
    ('TS', 'T-Shirts',   'Maica'),
    ('SH', 'Shirts',     'Këmisha'),
    ('PN', 'Pants',      'Pantallona'),
    ('JN', 'Jeans',      'Xhinse'),
    ('SK', 'Skirts',     'Funde'),
    ('JK', 'Jackets',    'Xhaketa'),
    ('CT', 'Coats',      'Pallto'),
    ('KN', 'Knitwear',   'Triko'),
    ('ST', 'Sets',       'Komplete'),
    ('SP', 'Sportswear', 'Veshje sportive')
  ) as v(code, en, sq)
 where c.code = v.code and c.name = v.en and c.name_sq is null;

update public.colors c
   set name_sq = v.sq
  from (values
    ('BLK', 'Black',       'E zezë'),
    ('WHT', 'White',       'E bardhë'),
    ('CRM', 'Cream',       'Krem'),
    ('BEI', 'Beige',       'Bezhë'),
    ('BRN', 'Brown',       'Kafe'),
    ('GRY', 'Grey',        'Gri'),
    ('NVY', 'Navy',        'Blu e errët'),
    ('BLU', 'Blue',        'Blu'),
    ('GRN', 'Green',       'E gjelbër'),
    ('OLV', 'Olive',       'Ulliri'),
    ('RED', 'Red',         'E kuqe'),
    ('BRD', 'Burgundy',    'Bordo'),
    ('PNK', 'Pink',        'Rozë'),
    ('PUR', 'Purple',      'Vjollcë'),
    ('YLW', 'Yellow',      'E verdhë'),
    ('ORG', 'Orange',      'Portokalli'),
    ('GLD', 'Gold',        'E artë'),
    ('SLV', 'Silver',      'E argjendtë'),
    ('MLT', 'Multicolour', 'Shumëngjyrëshe')
  ) as v(code, en, sq)
 where c.code = v.code and c.name = v.en and c.name_sq is null;

update public.sizes
   set label_sq = 'Një masë'
 where code = 'OS' and label = 'One size' and label_sq is null;

-- ---------------------------------------------------------------------------
-- Tracking an order, as before, plus each line's colour and size in Albanian.
-- The order keeps the English names it was placed with; the Albanian ones are
-- looked up as they are now, and the page falls back to the English if empty.

create or replace function public.track_order(p_order_number text, p_phone text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'order_number',  o.order_number,
    'status',        o.status,
    'created_at',    o.created_at,
    'dispatched_at', o.dispatched_at,
    'delivered_at',  o.delivered_at,
    'country',       o.country,
    'currency',      o.currency,
    'city',          o.delivery_city,
    'first_name',    split_part(o.delivery_name, ' ', 1),
    'delivery_fee',  o.delivery_fee_in_currency,
    'total',         o.total_in_currency,
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name',     l.product_name_snapshot,
               'color',    l.color_snapshot,
               'color_sq', c.name_sq,
               'size',     l.size_snapshot,
               'size_sq',  s.label_sq,
               'qty',      l.qty,
               'price',    l.unit_price_in_currency
             ) order by l.id), '[]'::jsonb)
        from public.order_lines l
        join public.variants v on v.id = l.variant_id
        join public.colors c on c.id = v.color_id
        join public.sizes s on s.id = v.size_id
       where l.order_id = o.id)
  )
  from public.orders o
  where o.order_number = upper(trim(p_order_number))
    -- The last eight digits must match: forgiving of +383 vs 0, strict enough to need the real number.
    and length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 8
    and right(regexp_replace(o.delivery_phone, '\D', '', 'g'), 8) = right(regexp_replace(p_phone, '\D', '', 'g'), 8);
$$;
