-- Starting reference data. Safe to edit: none of this is referenced by
-- transactions until products are created.
--
-- Sizes and categories are a first guess. Confirm the real lists with the shop
-- (numeric 36/38/40 vs lettered S/M/L) before entering products.

insert into public.categories (code, name, name_sq, size_type, sort_order) values
  ('DR', 'Dresses',     'Fustane',         'letter', 10),
  ('TP', 'Tops',        'Bluza',           'letter', 20),
  ('TS', 'T-Shirts',    'Maica',           'letter', 30),
  ('SH', 'Shirts',      'Këmisha',         'letter', 40),
  ('PN', 'Pants',       'Pantallona',      'letter', 50),
  ('JN', 'Jeans',       'Xhinse',          'numeric', 60),
  ('SK', 'Skirts',      'Funde',           'letter', 70),
  ('JK', 'Jackets',     'Xhaketa',         'letter', 80),
  ('CT', 'Coats',       'Pallto',          'letter', 90),
  ('KN', 'Knitwear',    'Triko',           'letter', 100),
  ('ST', 'Sets',        'Komplete',        'letter', 110),
  ('SP', 'Sportswear',  'Veshje sportive', 'letter', 120)
on conflict (code) do nothing;

insert into public.colors (code, name, name_sq, hex, sort_order) values
  ('BLK', 'Black',       'E zezë',         '#111111', 10),
  ('WHT', 'White',       'E bardhë',       '#FFFFFF', 20),
  ('CRM', 'Cream',       'Krem',           '#F3EBDD', 30),
  ('BEI', 'Beige',       'Bezhë',          '#D8C3A5', 40),
  ('BRN', 'Brown',       'Kafe',           '#6B4630', 50),
  ('GRY', 'Grey',        'Gri',            '#8A8A8A', 60),
  ('NVY', 'Navy',        'Blu e errët',    '#1F2A44', 70),
  ('BLU', 'Blue',        'Blu',            '#2F6DB5', 80),
  ('GRN', 'Green',       'E gjelbër',      '#2E7D4F', 90),
  ('OLV', 'Olive',       'Ulliri',         '#6B6B2E', 100),
  ('RED', 'Red',         'E kuqe',         '#C62828', 110),
  ('BRD', 'Burgundy',    'Bordo',          '#6D1A2B', 120),
  ('PNK', 'Pink',        'Rozë',           '#E8A0B4', 130),
  ('PUR', 'Purple',      'Vjollcë',        '#6A3D9A', 140),
  ('YLW', 'Yellow',      'E verdhë',       '#F2C94C', 150),
  ('ORG', 'Orange',      'Portokalli',     '#E67E22', 160),
  ('GLD', 'Gold',        'E artë',         '#C9A43B', 170),
  ('SLV', 'Silver',      'E argjendtë',    '#BFC3C7', 180),
  ('MLT', 'Multicolour', 'Shumëngjyrëshe', null,      190)
on conflict (code) do nothing;

insert into public.sizes (code, label, size_type, sort_order) values
  ('XS',  'XS',  'letter',   10),
  ('S',   'S',   'letter',   20),
  ('M',   'M',   'letter',   30),
  ('L',   'L',   'letter',   40),
  ('XL',  'XL',  'letter',   50),
  ('XXL', 'XXL', 'letter',   60),
  ('34',  '34',  'numeric', 110),
  ('36',  '36',  'numeric', 120),
  ('38',  '38',  'numeric', 130),
  ('40',  '40',  'numeric', 140),
  ('42',  '42',  'numeric', 150),
  ('44',  '44',  'numeric', 160),
  ('OS',  'One size', 'one_size', 200)
on conflict (code) do nothing;

update public.sizes set label_sq = 'Një masë' where code = 'OS';

-- Fees are placeholders until the shop confirms what couriers charge.
insert into public.delivery_zones (country, currency, fee_eur, est_days) values
  ('XK', 'EUR', 2.00, '1–2 days'),
  ('MK', 'MKD', 4.00, '2–4 days'),
  ('AL', 'ALL', 4.00, '2–4 days')
on conflict (country) do nothing;
