-- Checkout: customers place their own orders.
--
-- The shop never writes to orders, customers or stock directly. It calls
-- public.place_order with what the customer chose (variant ids and quantities)
-- and who they are. Everything with money in it is worked out here, from the
-- database's own prices, so a tampered request can't name its own price.
--
-- Placing an order reserves the stock in the same transaction. Two customers
-- racing for the last dress: one gets it, the other is told it just sold out.

-- ---------------------------------------------------------------------------
-- What the customer saw, kept on the order.
--
-- A customer's details can change between orders (they move, they lend their
-- phone). The order keeps where *this* parcel goes, and the local-currency
-- amounts the customer was shown, so a six-month-old order still reads exactly
-- as it did at checkout.

alter table public.orders
  add column delivery_name            text,
  add column delivery_phone           text,
  add column delivery_city            text,
  add column delivery_address         text,
  add column delivery_postal_code     text,
  add column delivery_fee_in_currency numeric(14, 2) not null default 0 check (delivery_fee_in_currency >= 0);

alter table public.order_lines
  add column unit_price_in_currency numeric(14, 2) check (unit_price_in_currency >= 0);

-- ---------------------------------------------------------------------------
-- Phone numbers
--
-- The same customer types "044 123 456" one week and "+383 44 123 456" the next.
-- Both become +38344123456, so a repeat customer is recognised, and the number
-- can be tapped to call from the admin.
--
-- A number already in international form (+ or 00) is kept as is. A local one
-- (leading 0, or none) takes the country being delivered to.

create function private.normalize_phone(p_phone text, p_country public.country_code) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v_raw     text := coalesce(p_phone, '');
  v_digits  text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_cc      text := case p_country when 'XK' then '383' when 'MK' then '389' when 'AL' then '355' end;
begin
  if v_raw ~ '^\s*\+' then
    null;                                       -- already international
  elsif v_digits like '00%' then
    v_digits := substr(v_digits, 3);            -- 00 389 ... -> 389 ...
  elsif v_digits ~ '^(383|389|355)' and length(v_digits) >= 11 then
    null;                                       -- typed the code without the +
  else
    v_digits := v_cc || regexp_replace(v_digits, '^0', '');
  end if;

  if length(v_digits) between 10 and 15 then
    return '+' || v_digits;
  end if;
  return null;
end $$;

revoke execute on function private.normalize_phone(text, public.country_code) from public;

-- ---------------------------------------------------------------------------
-- Placing an order

create function public.place_order(
  p_country         public.country_code,
  p_customer        jsonb,      -- {first_name, last_name, phone, city, address, postal_code}
  p_lines           jsonb,      -- [{variant_id, qty}, ...]
  p_notes           text    default null,
  p_expected_total  numeric default null   -- what the customer was shown, in their currency
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  max_qty_per_item  constant int := 5;
  max_items         constant int := 20;
  max_open_orders   constant int := 3;    -- unconfirmed orders per phone per day

  v_zone        public.delivery_zones;
  v_rate        numeric;
  v_first_name  text := trim(coalesce(p_customer ->> 'first_name', ''));
  v_last_name   text := trim(coalesce(p_customer ->> 'last_name', ''));
  v_city        text := trim(coalesce(p_customer ->> 'city', ''));
  v_address     text := trim(coalesce(p_customer ->> 'address', ''));
  v_postal      text := nullif(trim(coalesce(p_customer ->> 'postal_code', '')), '');
  v_notes       text := nullif(trim(coalesce(p_notes, '')), '');
  v_phone       text;

  v_lines       jsonb;
  v_missing     bigint;
  v_item        record;
  v_subtotal    numeric := 0;
  v_fee         numeric;
  v_fee_local   numeric;
  v_total_local numeric := 0;
  v_customer_id bigint;
  v_order       public.orders;
  v_available   int;
begin
  -- -------------------------------------------------- who and where
  select * into v_zone from public.delivery_zones z where z.country = p_country and z.active;
  if not found then
    raise exception 'invalid_order' using detail = 'country';
  end if;

  if length(v_first_name) = 0 or length(v_first_name) > 60 then
    raise exception 'invalid_order' using detail = 'first_name';
  end if;
  if length(v_last_name) > 60 then
    raise exception 'invalid_order' using detail = 'last_name';
  end if;
  if length(v_city) = 0 or length(v_city) > 80 then
    raise exception 'invalid_order' using detail = 'city';
  end if;
  if length(v_address) < 3 or length(v_address) > 200 then
    raise exception 'invalid_order' using detail = 'address';
  end if;
  if length(coalesce(v_postal, '')) > 12 then
    raise exception 'invalid_order' using detail = 'postal_code';
  end if;
  if length(coalesce(v_notes, '')) > 500 then
    raise exception 'invalid_order' using detail = 'notes';
  end if;

  v_phone := private.normalize_phone(p_customer ->> 'phone', p_country);
  if v_phone is null then
    raise exception 'invalid_order' using detail = 'phone';
  end if;

  -- -------------------------------------------------- what
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'invalid_order' using detail = 'empty';
  end if;

  -- The same item twice in one request counts once, with the quantities added.
  begin
    select jsonb_agg(jsonb_build_object('variant_id', g.variant_id, 'qty', g.qty) order by g.variant_id)
      into v_lines
      from (select (l ->> 'variant_id')::bigint as variant_id, sum((l ->> 'qty')::int)::int as qty
              from jsonb_array_elements(p_lines) l
             group by 1) g;
  exception when invalid_text_representation or numeric_value_out_of_range or cannot_coerce then
    raise exception 'invalid_order' using detail = 'lines';
  end;

  if jsonb_array_length(v_lines) > max_items then
    raise exception 'invalid_order' using detail = 'too_many_items';
  end if;
  if exists (select 1 from jsonb_to_recordset(v_lines) c(variant_id bigint, qty int)
              where c.variant_id is null or c.qty is null or c.qty < 1 or c.qty > max_qty_per_item) then
    raise exception 'invalid_order' using detail = 'qty';
  end if;

  -- Only what the shop is actually showing can be bought.
  select c.variant_id into v_missing
    from jsonb_to_recordset(v_lines) c(variant_id bigint, qty int)
   where not exists (
     select 1 from public.variants v
       join public.products p on p.id = v.product_id
      where v.id = c.variant_id and v.active and p.status = 'active' and p.show_online)
   limit 1;
  if v_missing is not null then
    raise exception 'not_available' using detail = v_missing::text;
  end if;

  -- -------------------------------------------------- how much
  -- Each price is converted and rounded the way the shop shows it, then added up,
  -- so the total matches what the customer saw item by item.
  for v_item in
    select c.qty, v.price_eur
      from jsonb_to_recordset(v_lines) c(variant_id bigint, qty int)
      join public.variants v on v.id = c.variant_id
  loop
    v_subtotal    := v_subtotal + v_item.qty * v_item.price_eur;
    v_total_local := v_total_local + v_item.qty * public.local_price(v_item.price_eur, v_zone.currency);
  end loop;

  v_fee := case when v_zone.free_over_eur is not null and v_subtotal >= v_zone.free_over_eur then 0 else v_zone.fee_eur end;
  v_fee_local := public.local_price(v_fee, v_zone.currency);
  v_total_local := v_total_local + v_fee_local;

  -- Prices can change while a customer has something in their bag. Rather than
  -- charge a total they never saw, stop and show them the new one.
  if p_expected_total is not null and p_expected_total <> v_total_local then
    raise exception 'price_changed' using detail = v_total_local::text;
  end if;

  v_rate := case v_zone.currency
              when 'EUR' then 1
              when 'MKD' then (select s.mkd_per_eur from public.settings s)
              when 'ALL' then (select s.all_per_eur from public.settings s)
            end;

  -- -------------------------------------------------- the customer
  -- Known by phone. Their stored details are not overwritten from the shop: anyone
  -- can type anyone's number. Where this parcel goes is kept on the order.
  select c.id into v_customer_id
    from public.customers c
   where c.phone_digits = regexp_replace(v_phone, '\D', '', 'g')
   order by c.id desc
   limit 1;

  if v_customer_id is not null and (
       select count(*) from public.orders o
        where o.customer_id = v_customer_id and o.status = 'new' and o.created_at > now() - interval '1 day'
     ) >= max_open_orders then
    raise exception 'too_many_orders';
  end if;

  if v_customer_id is null then
    insert into public.customers (first_name, last_name, phone, country, city, address, postal_code)
    values (v_first_name, v_last_name, v_phone, p_country, v_city, v_address, v_postal)
    returning id into v_customer_id;
  end if;

  -- -------------------------------------------------- the order
  insert into public.orders (
    customer_id, channel, country, currency, currency_per_eur,
    subtotal_eur, delivery_fee_eur, total_eur, total_in_currency, delivery_fee_in_currency,
    delivery_name, delivery_phone, delivery_city, delivery_address, delivery_postal_code,
    customer_notes
  ) values (
    v_customer_id, 'online', p_country, v_zone.currency, v_rate,
    v_subtotal, v_fee, v_subtotal + v_fee, v_total_local, v_fee_local,
    trim(v_first_name || ' ' || v_last_name), v_phone, v_city, v_address, v_postal,
    v_notes
  ) returning * into v_order;

  -- Lowest id first (v_lines is sorted), so two orders for the same items lock
  -- them in the same order and can't deadlock each other.
  for v_item in
    select c.variant_id, c.qty, v.price_eur
      from jsonb_to_recordset(v_lines) c(variant_id bigint, qty int)
      join public.variants v on v.id = c.variant_id
     order by c.variant_id
  loop
    insert into public.order_lines (order_id, variant_id, qty, unit_price_eur, unit_price_in_currency)
    values (v_order.id, v_item.variant_id, v_item.qty, v_item.price_eur,
            public.local_price(v_item.price_eur, v_zone.currency));

    begin
      perform private.apply_stock_movement(v_item.variant_id, 'reserve', v_item.qty, 'order', v_order.id);
    exception when others then
      if sqlerrm = 'insufficient_stock' then
        select greatest(s.qty_available, 0) into v_available from public.stock s where s.variant_id = v_item.variant_id;
        raise exception 'insufficient_stock' using detail = v_item.variant_id::text, hint = coalesce(v_available, 0)::text;
      end if;
      raise;
    end;
  end loop;

  return jsonb_build_object(
    'order_number', v_order.order_number,
    'currency', v_order.currency,
    'total_in_currency', v_order.total_in_currency
  );
end $$;

revoke execute on function public.place_order(public.country_code, jsonb, jsonb, text, numeric) from public;
grant execute on function public.place_order(public.country_code, jsonb, jsonb, text, numeric) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tracking an order
--
-- No customer accounts: the order number plus the phone it was placed with is
-- the key. Either alone gets nothing, and the answer leaves out the street
-- address, so a guessed pair reveals little.

create function public.track_order(p_order_number text, p_phone text) returns jsonb
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
               'name',  l.product_name_snapshot,
               'color', l.color_snapshot,
               'size',  l.size_snapshot,
               'qty',   l.qty,
               'price', l.unit_price_in_currency
             ) order by l.id), '[]'::jsonb)
        from public.order_lines l
       where l.order_id = o.id)
  )
  from public.orders o
  where o.order_number = upper(trim(p_order_number))
    -- The last eight digits must match: forgiving of +383 vs 0, strict enough to need the real number.
    and length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 8
    and right(regexp_replace(o.delivery_phone, '\D', '', 'g'), 8) = right(regexp_replace(p_phone, '\D', '', 'g'), 8);
$$;

revoke execute on function public.track_order(text, text) from public;
grant execute on function public.track_order(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Staff read the new delivery columns along with the rest of the order (the
-- existing table-level select grant covers them). Nothing else changes: orders
-- are still written only through functions.
