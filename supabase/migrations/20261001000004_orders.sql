-- Customers, orders, returns.
--
-- Order status and payment status are two independent state machines:
--
--   status          new -> confirmed -> dispatched -> delivered -> completed
--                   + cancelled | delivery_failed | returned | partially_returned
--   payment_status  unpaid -> paid -> (partially_refunded | refunded)
--
--   completed = delivered AND paid
--
-- "Reserved" is not a status: it is the stock effect of an order existing.
-- The functions that move orders through these states (and move stock with them)
-- arrive with the shop and order-management phases. Until then, staff can read
-- orders but not write them directly.

create type public.country_code as enum ('XK', 'MK', 'AL');
create type public.currency_code as enum ('EUR', 'MKD', 'ALL');
create type public.order_channel as enum ('online', 'manual');
create type public.order_status as enum (
  'new', 'confirmed', 'dispatched', 'delivered', 'completed',
  'cancelled', 'delivery_failed', 'returned', 'partially_returned'
);
create type public.payment_status as enum ('unpaid', 'paid', 'partially_refunded', 'refunded');

-- ---------------------------------------------------------------------------
-- Customers
--
-- Phone is the real identifier: Instagram customers have phone numbers,
-- not reliably email addresses.

create table public.customers (
  id                bigint generated always as identity primary key,
  first_name        text not null check (length(trim(first_name)) > 0),
  last_name         text not null default '',
  phone             text not null check (length(regexp_replace(phone, '\D', '', 'g')) >= 6),
  phone_digits      text generated always as (regexp_replace(phone, '\D', '', 'g')) stored,
  email             text,
  country           public.country_code not null,
  city              text not null,
  address           text not null,
  postal_code       text,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index customers_phone_idx on public.customers (phone_digits);

create trigger customers_touch
  before update on public.customers
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Orders

create sequence public.order_number_seq;

create table public.orders (
  id                 bigint generated always as identity primary key,
  order_number       text not null unique,
  customer_id        bigint not null references public.customers (id),
  channel            public.order_channel not null,
  status             public.order_status not null default 'new',
  payment_status     public.payment_status not null default 'unpaid',

  -- Books run in EUR; the courier collects local currency. The rate is frozen
  -- at order time because COD cash arrives days later and the lek floats.
  country            public.country_code not null,
  currency           public.currency_code not null,
  currency_per_eur   numeric(14, 6) not null check (currency_per_eur > 0),
  subtotal_eur       numeric(12, 2) not null default 0 check (subtotal_eur >= 0),
  delivery_fee_eur   numeric(12, 2) not null default 0 check (delivery_fee_eur >= 0),
  discount_eur       numeric(12, 2) not null default 0 check (discount_eur >= 0),
  total_eur          numeric(12, 2) not null default 0 check (total_eur >= 0),
  total_in_currency  numeric(14, 2) not null default 0 check (total_in_currency >= 0),
  amount_collected   numeric(14, 2) check (amount_collected >= 0),

  delivery_method    text,
  courier_name       text,
  tracking_ref       text,
  delivery_notes     text,
  customer_notes     text,

  confirmed_at       timestamptz,
  dispatched_at      timestamptz,
  delivered_at       timestamptz,
  paid_at            timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  cancelled_reason   text,

  locked             boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  check (currency <> 'EUR' or currency_per_eur = 1),
  check (status <> 'completed' or (payment_status = 'paid' and delivered_at is not null and paid_at is not null))
);

create index orders_status_idx on public.orders (status, created_at desc);
create index orders_customer_idx on public.orders (customer_id);

create function private.assign_order_number() returns trigger
language plpgsql as $$
begin
  if new.order_number is null then
    new.order_number := 'HC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.order_number_seq')::text, 4, '0');
  end if;
  return new;
end $$;

create trigger orders_assign_number
  before insert on public.orders
  for each row execute function private.assign_order_number();

-- Completing an order freezes it. After that, corrections go through a return.
create function private.guard_order() returns trigger
language plpgsql as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.locked := true;
    new.completed_at := coalesce(new.completed_at, now());
  end if;

  if old.locked then
    if not new.locked then
      raise exception 'order_locked' using detail = 'a completed order cannot be unlocked';
    end if;
    if (to_jsonb(new) - '{status,payment_status,updated_at}'::text[])
       is distinct from (to_jsonb(old) - '{status,payment_status,updated_at}'::text[]) then
      raise exception 'order_locked'
        using detail = format('order %s is completed; correct it with a return', old.order_number);
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger orders_guard
  before update on public.orders
  for each row execute function private.guard_order();

-- ---------------------------------------------------------------------------
-- Order lines
--
-- Names, colours and sizes are copied onto the line so a six-month-old order
-- still reads correctly after the product is renamed or archived.

create table public.order_lines (
  id                     bigint generated always as identity primary key,
  order_id               bigint not null references public.orders (id) on delete cascade,
  variant_id             bigint not null references public.variants (id),
  sku_snapshot           text not null,
  product_name_snapshot  text not null,
  color_snapshot         text not null,
  size_snapshot          text not null,
  qty                    int not null check (qty > 0),
  default_price_eur      numeric(12, 2) not null check (default_price_eur >= 0),
  unit_price_eur         numeric(12, 2) not null check (unit_price_eur >= 0),
  discount_eur           numeric(12, 2) not null default 0 check (discount_eur >= 0),
  line_total_eur         numeric(12, 2) not null check (line_total_eur >= 0),

  -- Frozen at dispatch. Cost moves every time they restock; without this,
  -- restocking would silently rewrite the profit on orders already shipped.
  unit_cost_eur          numeric(12, 4),

  returned_qty           int not null default 0 check (returned_qty >= 0),
  check (returned_qty <= qty),
  unique (order_id, variant_id)
);

create index order_lines_variant_idx on public.order_lines (variant_id);

create function private.snapshot_order_line() returns trigger
language plpgsql as $$
begin
  select v.sku, p.name, c.name, s.label, v.price_eur
    into new.sku_snapshot, new.product_name_snapshot, new.color_snapshot, new.size_snapshot, new.default_price_eur
    from public.variants v
    join public.products p on p.id = v.product_id
    join public.colors c on c.id = v.color_id
    join public.sizes s on s.id = v.size_id
   where v.id = new.variant_id;

  new.unit_price_eur := coalesce(new.unit_price_eur, new.default_price_eur);
  new.line_total_eur := coalesce(new.line_total_eur, new.qty * new.unit_price_eur - new.discount_eur);
  return new;
end $$;

create trigger order_lines_snapshot
  before insert on public.order_lines
  for each row execute function private.snapshot_order_line();

create function private.guard_order_line() returns trigger
language plpgsql as $$
declare
  is_locked boolean;
begin
  select locked into is_locked from public.orders where id = coalesce(new.order_id, old.order_id);
  if is_locked then
    if tg_op <> 'UPDATE'
       or (to_jsonb(new) - 'returned_qty') is distinct from (to_jsonb(old) - 'returned_qty') then
      raise exception 'order_locked' using detail = 'lines of a completed order cannot change; record a return instead';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger order_lines_guard
  before insert or update or delete on public.order_lines
  for each row execute function private.guard_order_line();

-- ---------------------------------------------------------------------------
-- Status history, written automatically so it can't be forgotten

create table public.order_status_history (
  id                   bigint generated always as identity primary key,
  order_id             bigint not null references public.orders (id) on delete cascade,
  from_status          public.order_status,
  to_status            public.order_status not null,
  from_payment_status  public.payment_status,
  to_payment_status    public.payment_status not null,
  note                 text,
  user_id              uuid default auth.uid(),
  created_at           timestamptz not null default now()
);

create index order_status_history_order_idx on public.order_status_history (order_id, created_at);

create function private.record_order_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT'
     or new.status is distinct from old.status
     or new.payment_status is distinct from old.payment_status then
    insert into public.order_status_history (order_id, from_status, to_status, from_payment_status, to_payment_status, note)
    values (
      new.id,
      case when tg_op = 'UPDATE' then old.status end,
      new.status,
      case when tg_op = 'UPDATE' then old.payment_status end,
      new.payment_status,
      nullif(current_setting('heychika.status_note', true), '')
    );
  end if;
  return new;
end $$;

create trigger orders_record_status
  after insert or update on public.orders
  for each row execute function private.record_order_status();

-- ---------------------------------------------------------------------------
-- Returns
--
-- Condition is per line: one parcel can come back with one dress fine and one stained.

create type public.return_condition as enum ('saleable', 'damaged');

create sequence public.return_number_seq;

create table public.returns (
  id                      bigint generated always as identity primary key,
  return_number           text not null unique
                            default 'RT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.return_number_seq')::text, 4, '0'),
  order_id                bigint not null references public.orders (id),
  reason                  text not null,
  refund_amount_eur       numeric(12, 2) not null default 0 check (refund_amount_eur >= 0),
  refund_amount_currency  numeric(14, 2) not null default 0 check (refund_amount_currency >= 0),
  refund_method           text,
  notes                   text,
  user_id                 uuid default auth.uid(),
  created_at              timestamptz not null default now()
);

create index returns_order_idx on public.returns (order_id);

create table public.return_lines (
  id             bigint generated always as identity primary key,
  return_id      bigint not null references public.returns (id) on delete cascade,
  order_line_id  bigint not null references public.order_lines (id),
  variant_id     bigint not null references public.variants (id),
  qty            int not null check (qty > 0),
  condition      public.return_condition not null
);

create index return_lines_return_idx on public.return_lines (return_id);
