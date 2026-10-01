-- Staff profiles, shop settings, delivery zones.

-- ---------------------------------------------------------------------------
-- Staff
--
-- Being logged in is not enough: a user is staff only if they have a profile row.
-- Profiles are created by hand for the two owners (see README). Even if public
-- sign-ups were left on by mistake, a stranger who signs up sees nothing.

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null,
  role        text not null default 'owner' check (role in ('owner', 'staff')),
  created_at  timestamptz not null default now()
);

create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Settings: a single row

create table public.settings (
  id                  boolean primary key default true check (id),
  store_name          text not null default 'Hey Chika',
  contact_phone       text,
  contact_email       text,
  instagram_url       text,
  tiktok_url          text,
  facebook_url        text,

  -- Units per 1 EUR. MKD is pegged and barely moves; ALL floats.
  mkd_per_eur         numeric(14, 6) not null default 61.5 check (mkd_per_eur > 0),
  all_per_eur         numeric(14, 6) not null default 98 check (all_per_eur > 0),
  fx_updated_at       timestamptz not null default now(),

  -- Converted prices round up to these steps: a EUR 25 dress should read
  -- 1550 MKD, not 1537.50 MKD.
  mkd_rounding        numeric(10, 2) not null default 50 check (mkd_rounding > 0),
  all_rounding        numeric(10, 2) not null default 100 check (all_rounding > 0),

  default_markup_pct  numeric(6, 2) not null default 50 check (default_markup_pct >= 0),
  updated_at          timestamptz not null default now()
);

create trigger settings_touch
  before update on public.settings
  for each row execute function private.touch_updated_at();

create function private.touch_fx_updated_at() returns trigger
language plpgsql as $$
begin
  if new.mkd_per_eur is distinct from old.mkd_per_eur or new.all_per_eur is distinct from old.all_per_eur then
    new.fx_updated_at := now();
  end if;
  return new;
end $$;

create trigger settings_touch_fx
  before update on public.settings
  for each row execute function private.touch_fx_updated_at();

insert into public.settings default values;

-- ---------------------------------------------------------------------------
-- Delivery zones: one per country, all shipped from Prishtina

create table public.delivery_zones (
  country        public.country_code primary key,
  currency       public.currency_code not null,
  fee_eur        numeric(12, 2) not null default 0 check (fee_eur >= 0),
  free_over_eur  numeric(12, 2) check (free_over_eur >= 0),
  est_days       text,
  active         boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Price display: EUR -> local currency, rounded up to the configured step.

create function public.local_price(p_eur numeric, p_currency public.currency_code) returns numeric
language sql stable security definer set search_path = '' as $$
  select case p_currency
    when 'EUR' then p_eur
    when 'MKD' then ceil(p_eur * s.mkd_per_eur / s.mkd_rounding) * s.mkd_rounding
    when 'ALL' then ceil(p_eur * s.all_per_eur / s.all_rounding) * s.all_rounding
  end
  from public.settings s;
$$;
