-- Starting reference data. Safe to edit: none of this is referenced by
-- transactions until products are created.
--
-- Sizes and categories are a first guess. Confirm the real lists with the shop
-- (numeric 36/38/40 vs lettered S/M/L) before entering products.

insert into public.categories (code, name, size_type, sort_order) values
  ('DR', 'Dresses',     'letter', 10),
  ('TP', 'Tops',        'letter', 20),
  ('TS', 'T-Shirts',    'letter', 30),
  ('SH', 'Shirts',      'letter', 40),
  ('PN', 'Pants',       'letter', 50),
  ('JN', 'Jeans',       'numeric', 60),
  ('SK', 'Skirts',      'letter', 70),
  ('JK', 'Jackets',     'letter', 80),
  ('CT', 'Coats',       'letter', 90),
  ('KN', 'Knitwear',    'letter', 100),
  ('ST', 'Sets',        'letter', 110),
  ('SP', 'Sportswear',  'letter', 120)
on conflict (code) do nothing;

insert into public.colors (code, name, hex, sort_order) values
  ('BLK', 'Black',      '#111111', 10),
  ('WHT', 'White',      '#FFFFFF', 20),
  ('CRM', 'Cream',      '#F3EBDD', 30),
  ('BEI', 'Beige',      '#D8C3A5', 40),
  ('BRN', 'Brown',      '#6B4630', 50),
  ('GRY', 'Grey',       '#8A8A8A', 60),
  ('NVY', 'Navy',       '#1F2A44', 70),
  ('BLU', 'Blue',       '#2F6DB5', 80),
  ('GRN', 'Green',      '#2E7D4F', 90),
  ('OLV', 'Olive',      '#6B6B2E', 100),
  ('RED', 'Red',        '#C62828', 110),
  ('BRD', 'Burgundy',   '#6D1A2B', 120),
  ('PNK', 'Pink',       '#E8A0B4', 130),
  ('PUR', 'Purple',     '#6A3D9A', 140),
  ('YLW', 'Yellow',     '#F2C94C', 150),
  ('ORG', 'Orange',     '#E67E22', 160),
  ('GLD', 'Gold',       '#C9A43B', 170),
  ('SLV', 'Silver',     '#BFC3C7', 180),
  ('MLT', 'Multicolour', null,     190)
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

-- Fees are placeholders until the shop confirms what couriers charge.
insert into public.delivery_zones (country, currency, fee_eur, est_days) values
  ('XK', 'EUR', 2.00, '1–2 days'),
  ('MK', 'MKD', 4.00, '2–4 days'),
  ('AL', 'ALL', 4.00, '2–4 days')
on conflict (country) do nothing;
