-- Catalogue: categories, colours, sizes, products, variants, images.
--
-- products = a design ("black satin wrap dress")
-- variants = one colour + size of that design; the thing with a SKU, a barcode and a stock count

create schema if not exists private;
revoke all on schema private from public;

create type public.size_type as enum ('letter', 'numeric', 'one_size');
create type public.product_status as enum ('draft', 'active', 'archived');

create function private.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Lookup tables

create table public.categories (
  id          bigint generated always as identity primary key,
  code        text not null unique check (code ~ '^[A-Z]{2,3}$'),
  name        text not null,
  size_type   public.size_type not null default 'letter',
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.colors (
  id          bigint generated always as identity primary key,
  code        text not null unique check (code ~ '^[A-Z]{3}$'),
  name        text not null,
  hex         text check (hex ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order  int not null default 0,
  active      boolean not null default true
);

-- sort_order exists so S, M, L sort by size rather than alphabetically
create table public.sizes (
  id          bigint generated always as identity primary key,
  code        text not null unique check (code ~ '^[A-Z0-9]{1,5}$'),
  label       text not null,
  size_type   public.size_type not null,
  sort_order  int not null default 0,
  active      boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Products

create table public.products (
  id           bigint generated always as identity primary key,
  category_id  bigint not null references public.categories (id),
  model_code   text not null check (model_code ~ '^[0-9]{3,}$'),
  name         text not null check (length(trim(name)) > 0),
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description  text,
  material     text,
  brand        text,
  status       public.product_status not null default 'draft',
  show_online  boolean not null default false,
  featured     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (category_id, model_code)
);

create index products_category_idx on public.products (category_id);

-- She types a name; the next number in the category is assigned automatically.
-- Locking the category row serialises concurrent inserts into the same category.
create function private.assign_model_code() returns trigger
language plpgsql as $$
declare
  next_n int;
begin
  if new.model_code is null then
    perform 1 from public.categories where id = new.category_id for update;
    select coalesce(max(model_code::int), 0) + 1 into next_n
      from public.products where category_id = new.category_id;
    new.model_code := lpad(next_n::text, 3, '0');
  end if;
  return new;
end $$;

create trigger products_assign_model_code
  before insert on public.products
  for each row execute function private.assign_model_code();

create trigger products_touch
  before update on public.products
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Variants

create table public.variants (
  id                    bigint generated always as identity primary key,
  product_id            bigint not null references public.products (id),
  color_id              bigint not null references public.colors (id),
  size_id               bigint not null references public.sizes (id),
  sku                   text not null unique,
  barcode               text not null unique,
  cost_eur              numeric(12, 4) not null default 0 check (cost_eur >= 0),
  price_eur             numeric(12, 2) not null default 0 check (price_eur >= 0),
  compare_at_price_eur  numeric(12, 2) check (compare_at_price_eur >= 0),
  locked                boolean not null default false,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (product_id, color_id, size_id)
);

create index variants_product_idx on public.variants (product_id);

-- SKU = CATEGORY-MODEL-COLOUR-SIZE, e.g. DR-001-BLK-M.
-- The barcode is Code128 encoding the SKU, so by default they're the same string.
create function private.generate_sku() returns trigger
language plpgsql as $$
begin
  if new.sku is null then
    select c.code || '-' || p.model_code || '-' || col.code || '-' || s.code
      into new.sku
      from public.products p
      join public.categories c on c.id = p.category_id
      join public.colors col on col.id = new.color_id
      join public.sizes s on s.id = new.size_id
     where p.id = new.product_id;
  end if;
  new.barcode := coalesce(new.barcode, new.sku);
  return new;
end $$;

create trigger variants_generate_sku
  before insert on public.variants
  for each row execute function private.generate_sku();

-- Once a variant has been used in any transaction, its identity is frozen.
-- Corrections go through private.correct_variant_codes, which records the change.
create function private.guard_locked_variant() returns trigger
language plpgsql as $$
begin
  if old.locked and current_setting('heychika.code_correction', true) is distinct from 'on' then
    if new.sku is distinct from old.sku or new.barcode is distinct from old.barcode then
      raise exception 'variant_locked'
        using detail = format('SKU %s has transaction history; its SKU and barcode cannot be edited', old.sku);
    end if;
  end if;
  if old.locked then
    if new.product_id is distinct from old.product_id
       or new.color_id is distinct from old.color_id
       or new.size_id is distinct from old.size_id then
      raise exception 'variant_locked'
        using detail = format('SKU %s has transaction history; its product, colour and size cannot change', old.sku);
    end if;
    if not new.locked then
      raise exception 'variant_locked' using detail = 'a locked variant cannot be unlocked';
    end if;
  end if;
  return new;
end $$;

create trigger variants_guard_locked
  before update on public.variants
  for each row execute function private.guard_locked_variant();

create trigger variants_touch
  before update on public.variants
  for each row execute function private.touch_updated_at();

-- A product whose variants are locked can't move category or renumber,
-- since both are baked into those variants' SKUs.
create function private.guard_locked_product() returns trigger
language plpgsql as $$
begin
  if (new.category_id is distinct from old.category_id or new.model_code is distinct from old.model_code)
     and exists (select 1 from public.variants where product_id = old.id and locked) then
    raise exception 'product_locked'
      using detail = 'this product has variants with transaction history; category and model code are fixed';
  end if;
  return new;
end $$;

create trigger products_guard_locked
  before update on public.products
  for each row execute function private.guard_locked_product();

-- ---------------------------------------------------------------------------
-- SKU / barcode corrections (rare, deliberate, recorded)

create table public.variant_code_changes (
  id           bigint generated always as identity primary key,
  variant_id   bigint not null references public.variants (id),
  old_sku      text not null,
  new_sku      text not null,
  old_barcode  text not null,
  new_barcode  text not null,
  reason       text not null check (length(trim(reason)) > 0),
  user_id      uuid default auth.uid(),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Images

create table public.product_images (
  id            bigint generated always as identity primary key,
  product_id    bigint not null references public.products (id) on delete cascade,
  color_id      bigint references public.colors (id),
  storage_path  text not null,
  sort_order    int not null default 0,
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now()
);

create index product_images_product_idx on public.product_images (product_id);
create unique index product_images_one_primary on public.product_images (product_id) where is_primary;
