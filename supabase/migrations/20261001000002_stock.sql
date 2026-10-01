-- Stock: one balance row per variant, plus an append-only ledger.
--
-- Every change to stock goes through private.apply_stock_movement.
-- Nothing else writes to public.stock or public.stock_movements.

create type public.movement_type as enum (
  'stock_in',         -- goods received from a purchase
  'reserve',          -- order placed
  'release',          -- order cancelled before dispatch
  'dispatch',         -- goods leave Prishtina
  'deliver',          -- customer received the parcel
  'return_saleable',  -- came back, fit to sell again
  'return_damaged',   -- came back, not fit to sell
  'adjust',           -- stock count correction (signed)
  'mark_damaged',     -- found damaged on the shelf
  'writeoff'          -- damaged goods disposed of
);

-- ---------------------------------------------------------------------------
-- Balances

create table public.stock (
  variant_id      bigint primary key references public.variants (id),
  qty_physical    int not null default 0,
  qty_reserved    int not null default 0,
  qty_in_transit  int not null default 0,
  qty_damaged     int not null default 0,
  qty_available   int generated always as (qty_physical - qty_reserved) stored,
  min_stock       int not null default 0 check (min_stock >= 0),
  updated_at      timestamptz not null default now(),

  constraint physical_nonneg    check (qty_physical >= 0),
  constraint reserved_nonneg    check (qty_reserved >= 0),
  constraint in_transit_nonneg  check (qty_in_transit >= 0),
  constraint damaged_nonneg     check (qty_damaged >= 0),

  -- The overselling guarantee. Two customers racing for the last dress:
  -- the second reservation fails here, at the database, whatever the app does.
  constraint no_overselling     check (qty_physical >= qty_reserved)
);

create function private.create_stock_row() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.stock (variant_id) values (new.id);
  return new;
end $$;

create trigger variants_create_stock
  after insert on public.variants
  for each row execute function private.create_stock_row();

-- ---------------------------------------------------------------------------
-- Ledger

create table public.stock_movements (
  id                bigint generated always as identity primary key,
  variant_id        bigint not null references public.variants (id),
  type              public.movement_type not null,
  qty               int not null check (qty <> 0 and (qty > 0 or type = 'adjust')),
  delta_physical    int not null,
  delta_reserved    int not null,
  delta_in_transit  int not null,
  delta_damaged     int not null,
  ref_type          text check (ref_type in ('purchase', 'order', 'return', 'adjustment')),
  ref_id            bigint,
  unit_cost_eur     numeric(12, 4),
  note              text,
  user_id           uuid default auth.uid(),
  created_at        timestamptz not null default now()
);

create index stock_movements_variant_idx on public.stock_movements (variant_id, created_at);
create index stock_movements_ref_idx on public.stock_movements (ref_type, ref_id);

create function private.forbid_ledger_rewrite() returns trigger
language plpgsql as $$
begin
  raise exception 'stock_movements is append-only';
end $$;

create trigger stock_movements_append_only
  before update or delete on public.stock_movements
  for each row execute function private.forbid_ledger_rewrite();

-- ---------------------------------------------------------------------------
-- The inventory engine
--
--   type              physical  reserved  in_transit  damaged
--   stock_in            +q
--   reserve                       +q
--   release                       -q
--   dispatch            -q        -q        +q
--   deliver                                 -q
--   return_saleable     +q                  -q*
--   return_damaged                          -q*         +q
--   adjust              ±q
--   mark_damaged        -q                              +q
--   writeoff                                            -q
--
--   * only when p_from_transit: a refused parcel is still in transit;
--     an item the customer sends back after delivery is not.

create function private.apply_stock_movement(
  p_variant_id     bigint,
  p_type           public.movement_type,
  p_qty            int,
  p_ref_type       text    default null,
  p_ref_id         bigint  default null,
  p_unit_cost_eur  numeric default null,
  p_note           text    default null,
  p_from_transit   boolean default true
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  dp int := 0;
  dr int := 0;
  dt int := 0;
  dd int := 0;
  movement_id bigint;
  failed_constraint text;
begin
  if p_qty is null or p_qty = 0 then
    raise exception 'invalid_stock_movement' using detail = 'quantity must be non-zero';
  end if;
  if p_qty < 0 and p_type <> 'adjust' then
    raise exception 'invalid_stock_movement' using detail = format('%s needs a positive quantity', p_type);
  end if;

  case p_type
    when 'stock_in'        then dp :=  p_qty;
    when 'reserve'         then dr :=  p_qty;
    when 'release'         then dr := -p_qty;
    when 'dispatch'        then dp := -p_qty; dr := -p_qty; dt := p_qty;
    when 'deliver'         then dt := -p_qty;
    when 'return_saleable' then dp :=  p_qty; dt := case when p_from_transit then -p_qty else 0 end;
    when 'return_damaged'  then dd :=  p_qty; dt := case when p_from_transit then -p_qty else 0 end;
    when 'adjust'          then dp :=  p_qty;
    when 'mark_damaged'    then dp := -p_qty; dd := p_qty;
    when 'writeoff'        then dd := -p_qty;
  end case;

  begin
    -- UPDATE takes the row lock, so concurrent movements on one variant run one
    -- at a time and each re-checks the constraints against the committed balance.
    update public.stock
       set qty_physical   = qty_physical + dp,
           qty_reserved   = qty_reserved + dr,
           qty_in_transit = qty_in_transit + dt,
           qty_damaged    = qty_damaged + dd,
           updated_at     = now()
     where variant_id = p_variant_id;
  exception when check_violation then
    get stacked diagnostics failed_constraint = constraint_name;
    if failed_constraint in ('no_overselling', 'physical_nonneg') then
      raise exception 'insufficient_stock'
        using detail = format('variant %s: %s of %s not available', p_variant_id, p_type, p_qty);
    else
      raise exception 'invalid_stock_movement'
        using detail = format('variant %s: %s of %s would break %s', p_variant_id, p_type, p_qty, failed_constraint);
    end if;
  end;

  if not found then
    raise exception 'invalid_stock_movement' using detail = format('variant %s has no stock row', p_variant_id);
  end if;

  insert into public.stock_movements (
    variant_id, type, qty,
    delta_physical, delta_reserved, delta_in_transit, delta_damaged,
    ref_type, ref_id, unit_cost_eur, note
  ) values (
    p_variant_id, p_type, p_qty,
    dp, dr, dt, dd,
    p_ref_type, p_ref_id, p_unit_cost_eur, p_note
  ) returning id into movement_id;

  -- First real use freezes the SKU and barcode.
  update public.variants set locked = true where id = p_variant_id and not locked;

  return movement_id;
end $$;
