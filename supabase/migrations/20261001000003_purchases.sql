-- Purchases: a buying trip (e.g. Istanbul) and what was bought on it.
--
-- Exchange rates everywhere in this schema are "units of currency per 1 EUR",
-- the way people quote them: 61.5 MKD, 98 ALL, 45 TRY.

create type public.purchase_status as enum ('draft', 'received');
create type public.allocation_method as enum ('by_quantity', 'by_value');

create table public.purchases (
  id                 bigint generated always as identity primary key,
  reference          text not null check (length(trim(reference)) > 0),
  supplier_name      text,
  purchase_date      date not null default current_date,
  currency           text not null default 'EUR' check (currency in ('EUR', 'USD', 'TRY')),
  currency_per_eur   numeric(14, 6) not null default 1 check (currency_per_eur > 0),
  extra_costs_eur    numeric(12, 2) not null default 0 check (extra_costs_eur >= 0),
  allocation_method  public.allocation_method not null default 'by_quantity',
  status             public.purchase_status not null default 'draft',
  received_at        timestamptz,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (currency <> 'EUR' or currency_per_eur = 1),
  check ((status = 'received') = (received_at is not null))
);

create trigger purchases_touch
  before update on public.purchases
  for each row execute function private.touch_updated_at();

create table public.purchase_lines (
  id                    bigint generated always as identity primary key,
  purchase_id           bigint not null references public.purchases (id) on delete cascade,
  variant_id            bigint not null references public.variants (id),
  qty                   int not null check (qty > 0),
  unit_price            numeric(12, 2) not null check (unit_price >= 0),  -- in the purchase currency
  unit_price_eur        numeric(12, 4),  -- the four below are filled in on receive
  allocated_extra_eur   numeric(12, 4),
  unit_landed_cost_eur  numeric(12, 4),
  unique (purchase_id, variant_id)
);

create index purchase_lines_variant_idx on public.purchase_lines (variant_id);

-- A received purchase is history: it has already moved stock and cost.
create function private.guard_received_purchase() returns trigger
language plpgsql as $$
declare
  pid bigint := coalesce(new.purchase_id, old.purchase_id);
begin
  if current_setting('heychika.receiving', true) is distinct from 'on'
     and exists (select 1 from public.purchases where id = pid and status = 'received') then
    raise exception 'purchase_received' using detail = format('purchase %s has been received and cannot be edited', pid);
  end if;
  return coalesce(new, old);
end $$;

create trigger purchase_lines_guard_received
  before insert or update or delete on public.purchase_lines
  for each row execute function private.guard_received_purchase();

create function private.guard_received_purchase_header() returns trigger
language plpgsql as $$
begin
  if old.status = 'received' then
    if tg_op = 'DELETE' then
      raise exception 'purchase_received' using detail = format('purchase %s has been received and cannot be deleted', old.id);
    end if;
    if new.currency is distinct from old.currency
       or new.currency_per_eur is distinct from old.currency_per_eur
       or new.extra_costs_eur is distinct from old.extra_costs_eur
       or new.allocation_method is distinct from old.allocation_method
       or new.status is distinct from old.status
       or new.received_at is distinct from old.received_at then
      raise exception 'purchase_received' using detail = format('purchase %s has been received; only reference, supplier and notes can change', old.id);
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger purchases_guard_received
  before update or delete on public.purchases
  for each row execute function private.guard_received_purchase_header();

-- ---------------------------------------------------------------------------
-- Receiving
--
-- For each line:
--   unit_price_eur       = unit_price / currency_per_eur
--   allocated_extra_eur  = this line's share of the trip's extra costs, per unit
--   unit_landed_cost_eur = unit_price_eur + allocated_extra_eur
--
-- then the variant's weighted average cost is rolled forward:
--   cost = (cost * on_hand + landed * received) / (on_hand + received)
--
-- Buy 80 items on a trip that cost EUR 400 in travel and freight:
-- by quantity, EUR 5 lands on each.

create function public.receive_purchase(p_purchase_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p           public.purchases;
  line        record;
  total_qty   int;
  total_value numeric;
  unit_eur    numeric;
  extra_unit  numeric;
  landed      numeric;
  on_hand     int;
begin
  if not private.is_staff() then
    raise exception 'not_authorized';
  end if;

  select * into p from public.purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'not_found' using detail = format('purchase %s', p_purchase_id);
  end if;
  if p.status = 'received' then
    raise exception 'purchase_received' using detail = format('purchase %s was already received', p_purchase_id);
  end if;

  select coalesce(sum(qty), 0), coalesce(sum(qty * unit_price / p.currency_per_eur), 0)
    into total_qty, total_value
    from public.purchase_lines where purchase_id = p_purchase_id;

  if total_qty = 0 then
    raise exception 'invalid_purchase' using detail = 'a purchase needs at least one line to be received';
  end if;
  if p.allocation_method = 'by_value' and total_value = 0 and p.extra_costs_eur > 0 then
    raise exception 'invalid_purchase' using detail = 'cannot allocate extra costs by value when every line costs 0';
  end if;

  perform set_config('heychika.receiving', 'on', true);

  for line in
    select * from public.purchase_lines where purchase_id = p_purchase_id order by id
  loop
    unit_eur := line.unit_price / p.currency_per_eur;

    extra_unit := case
      when p.extra_costs_eur = 0 then 0
      when p.allocation_method = 'by_quantity' then p.extra_costs_eur / total_qty
      else p.extra_costs_eur * (unit_eur / total_value)
    end;

    landed := unit_eur + extra_unit;

    update public.purchase_lines
       set unit_price_eur       = round(unit_eur, 4),
           allocated_extra_eur  = round(extra_unit, 4),
           unit_landed_cost_eur = round(landed, 4)
     where id = line.id;

    select qty_physical into on_hand from public.stock where variant_id = line.variant_id for update;

    update public.variants
       set cost_eur = round((cost_eur * on_hand + landed * line.qty) / (on_hand + line.qty), 4)
     where id = line.variant_id;

    perform private.apply_stock_movement(
      line.variant_id, 'stock_in', line.qty, 'purchase', p_purchase_id, round(landed, 4)
    );
  end loop;

  update public.purchases set status = 'received', received_at = now() where id = p_purchase_id;

  perform set_config('heychika.receiving', 'off', true);
end $$;
