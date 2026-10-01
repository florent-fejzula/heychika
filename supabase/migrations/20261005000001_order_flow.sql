-- Moving orders along, and taking things back.
--
--   new ──confirm──> confirmed ──dispatch──> dispatched ──delivered──> delivered ──cash──> completed
--    └──────cancel──────┘                     │      ▲                    │
--                                     not delivered  try again            └── returns (any time after)
--                                             ▼      │
--                                        delivery_failed ── parcel back ──> returned
--
-- Every step is one function. Each moves the order and its stock together in one
-- transaction, so the shelf, the ledger and the order can't disagree. The admin calls
-- these; nothing writes to orders directly.
--
-- Stock, per line:
--   placed / added     reserve            (held for the customer)
--   cancelled          release            (back on sale)
--   dispatched         dispatch           (off the shelf, on the road; cost frozen on the line)
--   delivered          deliver            (gone for good)
--   refused at door    stays on the road  (refused_qty) until it is back and has been looked at
--   came back          return_saleable / return_damaged

-- ---------------------------------------------------------------------------
-- Items refused at the door
--
-- A COD customer can take one dress and hand the other back to the courier. That one
-- is still on the road until it reaches Prishtina, and nobody knows yet whether it can
-- be sold again, so it stays in transit and is counted here until its return is recorded.

alter table public.order_lines
  add column refused_qty int not null default 0 check (refused_qty >= 0),
  add constraint refused_within_qty check (refused_qty + returned_qty <= qty);

-- A completed order is frozen, except for what comes back.
create or replace function private.guard_order_line() returns trigger
language plpgsql as $$
declare
  is_locked boolean;
begin
  select locked into is_locked from public.orders where id = coalesce(new.order_id, old.order_id);
  if is_locked then
    if tg_op <> 'UPDATE'
       or (to_jsonb(new) - '{returned_qty,refused_qty}'::text[]) is distinct from (to_jsonb(old) - '{returned_qty,refused_qty}'::text[]) then
      raise exception 'order_locked' using detail = 'lines of a completed order cannot change; record a return instead';
    end if;
  end if;
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------------
-- Shared pieces

create function private.require_staff() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_staff() then
    raise exception 'not_authorized';
  end if;
end $$;

-- Locks the order for the rest of the transaction and checks it's in a state the step allows.
-- Two people pressing buttons on the same order at once take turns, and the second one is
-- told it has already moved on.
create function private.lock_order(p_order_id bigint, p_allowed public.order_status[]) returns public.orders
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'not_found' using detail = format('order %s', p_order_id);
  end if;
  if not (o.status = any (p_allowed)) then
    raise exception 'invalid_status' using detail = format('order %s is %s', o.order_number, o.status);
  end if;
  return o;
end $$;

-- The note that goes into the status history with the next change.
create function private.status_note(p_note text) returns void
language sql security definer set search_path = '' as $$
  select set_config('heychika.status_note', coalesce(nullif(trim(p_note), ''), ''), true);
$$;

-- Adds lines to an order and holds their stock.
--
--   p_lines  [{variant_id, qty, price?}]   price is per item, in the order's currency,
--                                          for a price agreed in a DM; otherwise today's price
--   p_keep   {variant_id: {eur, local}}    prices to keep when an order's items are edited
create function private.add_order_lines(p_order public.orders, p_lines jsonb, p_keep jsonb default '{}') returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item       record;
  v_variant    record;
  v_eur        numeric;
  v_local      numeric;
  v_available  int;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'invalid_order' using detail = 'empty';
  end if;

  begin
    -- Same item twice: one line, quantities added. Lowest id first, so concurrent orders lock in the same order.
    for v_item in
      select x.variant_id, sum(x.qty)::int as qty, max(x.price) as price
        from jsonb_to_recordset(p_lines) as x(variant_id bigint, qty int, price numeric)
       group by x.variant_id
       order by x.variant_id
    loop
      if v_item.variant_id is null or v_item.qty is null or v_item.qty < 1 or v_item.qty > 99 then
        raise exception 'invalid_order' using detail = 'qty';
      end if;
      if v_item.price is not null and v_item.price < 0 then
        raise exception 'invalid_order' using detail = 'price';
      end if;

      -- Staff can sell anything that isn't retired, including designs not shown online.
      select v.id, v.price_eur into v_variant
        from public.variants v join public.products p on p.id = v.product_id
       where v.id = v_item.variant_id and v.active and p.status <> 'archived';
      if not found then
        raise exception 'not_available' using detail = v_item.variant_id::text;
      end if;

      if v_item.price is not null then
        v_local := v_item.price;
        v_eur   := case when p_order.currency = 'EUR' then v_item.price else round(v_item.price / p_order.currency_per_eur, 2) end;
      elsif p_keep ? v_item.variant_id::text then
        v_local := (p_keep -> v_item.variant_id::text ->> 'local')::numeric;
        v_eur   := (p_keep -> v_item.variant_id::text ->> 'eur')::numeric;
      else
        v_local := public.local_price(v_variant.price_eur, p_order.currency);
        v_eur   := v_variant.price_eur;
      end if;

      insert into public.order_lines (order_id, variant_id, qty, unit_price_eur, unit_price_in_currency)
      values (p_order.id, v_item.variant_id, v_item.qty, v_eur, v_local);

      begin
        perform private.apply_stock_movement(v_item.variant_id, 'reserve', v_item.qty, 'order', p_order.id);
      exception when others then
        if sqlerrm = 'insufficient_stock' then
          select greatest(s.qty_available, 0) into v_available from public.stock s where s.variant_id = v_item.variant_id;
          raise exception 'insufficient_stock' using detail = v_item.variant_id::text, hint = coalesce(v_available, 0)::text;
        end if;
        raise;
      end;
    end loop;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_order' using detail = 'lines';
  end;
end $$;

-- Totals from the lines, plus a delivery fee in the order's currency.
create function private.recompute_order_totals(p_order_id bigint, p_fee_local numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o           public.orders;
  v_subtotal  numeric;
  v_items     numeric;
  v_fee_eur   numeric;
begin
  select * into o from public.orders where id = p_order_id;
  select coalesce(sum(l.line_total_eur), 0), coalesce(sum(l.qty * l.unit_price_in_currency), 0)
    into v_subtotal, v_items
    from public.order_lines l where l.order_id = p_order_id;
  v_fee_eur := case when o.currency = 'EUR' then p_fee_local else round(p_fee_local / o.currency_per_eur, 2) end;

  update public.orders
     set subtotal_eur = v_subtotal,
         delivery_fee_eur = v_fee_eur,
         delivery_fee_in_currency = p_fee_local,
         total_eur = v_subtotal + v_fee_eur,
         total_in_currency = v_items + p_fee_local
   where id = p_order_id;
end $$;

-- ---------------------------------------------------------------------------
-- Orders taken in a DM
--
-- The fallback for customers who won't use the shop. Starts confirmed: she agreed it
-- with the customer while typing it in. A price agreed in the DM can be entered as is,
-- in the customer's currency; the usual price is kept alongside it on the line.
--
--   p_customer  {id?, first_name, last_name, phone, city, address, postal_code}
--               With an id, that customer is used and their details brought up to date.
--               Without, a customer with the same phone is found, or a new one made.
--   p_delivery_fee  in the customer's currency; null for the usual fee for that country.

create function public.create_manual_order(
  p_country       public.country_code,
  p_customer      jsonb,
  p_lines         jsonb,
  p_delivery_fee  numeric default null,
  p_notes         text    default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_zone        public.delivery_zones;
  v_rate        numeric;
  v_phone       text;
  v_first       text := trim(coalesce(p_customer ->> 'first_name', ''));
  v_last        text := trim(coalesce(p_customer ->> 'last_name', ''));
  v_city        text := trim(coalesce(p_customer ->> 'city', ''));
  v_address     text := trim(coalesce(p_customer ->> 'address', ''));
  v_postal      text := nullif(trim(coalesce(p_customer ->> 'postal_code', '')), '');
  v_customer_id bigint := (p_customer ->> 'id')::bigint;
  v_order       public.orders;
  v_fee         numeric;
  v_subtotal    numeric;
begin
  perform private.require_staff();

  select * into v_zone from public.delivery_zones z where z.country = p_country;
  if not found then
    raise exception 'invalid_order' using detail = 'country';
  end if;
  if length(v_first) = 0 then
    raise exception 'invalid_order' using detail = 'first_name';
  end if;
  if length(v_city) = 0 then
    raise exception 'invalid_order' using detail = 'city';
  end if;
  if length(v_address) = 0 then
    raise exception 'invalid_order' using detail = 'address';
  end if;
  v_phone := private.normalize_phone(p_customer ->> 'phone', p_country);
  if v_phone is null then
    raise exception 'invalid_order' using detail = 'phone';
  end if;
  if p_delivery_fee is not null and p_delivery_fee < 0 then
    raise exception 'invalid_order' using detail = 'delivery_fee';
  end if;

  -- Staff are the source of truth for a customer's details, unlike the public shop.
  if v_customer_id is null then
    select c.id into v_customer_id from public.customers c
     where c.phone_digits = regexp_replace(v_phone, '\D', '', 'g')
     order by c.id desc limit 1;
  end if;
  if v_customer_id is null then
    insert into public.customers (first_name, last_name, phone, country, city, address, postal_code)
    values (v_first, v_last, v_phone, p_country, v_city, v_address, v_postal)
    returning id into v_customer_id;
  else
    update public.customers
       set first_name = v_first, last_name = v_last, phone = v_phone, country = p_country,
           city = v_city, address = v_address, postal_code = v_postal
     where id = v_customer_id;
    if not found then
      raise exception 'not_found' using detail = format('customer %s', v_customer_id);
    end if;
  end if;

  v_rate := case v_zone.currency
              when 'EUR' then 1
              when 'MKD' then (select s.mkd_per_eur from public.settings s)
              when 'ALL' then (select s.all_per_eur from public.settings s)
            end;

  insert into public.orders (
    customer_id, channel, status, confirmed_at, country, currency, currency_per_eur,
    delivery_name, delivery_phone, delivery_city, delivery_address, delivery_postal_code, delivery_notes
  ) values (
    v_customer_id, 'manual', 'confirmed', now(), p_country, v_zone.currency, v_rate,
    trim(v_first || ' ' || v_last), v_phone, v_city, v_address, v_postal, nullif(trim(coalesce(p_notes, '')), '')
  ) returning * into v_order;

  perform private.add_order_lines(v_order, p_lines);

  if p_delivery_fee is not null then
    v_fee := p_delivery_fee;
  else
    select coalesce(sum(line_total_eur), 0) into v_subtotal from public.order_lines where order_id = v_order.id;
    v_fee := public.local_price(
      case when v_zone.free_over_eur is not null and v_subtotal >= v_zone.free_over_eur then 0 else v_zone.fee_eur end,
      v_zone.currency);
  end if;
  perform private.recompute_order_totals(v_order.id, v_fee);

  return (select jsonb_build_object('id', o.id, 'order_number', o.order_number, 'total_in_currency', o.total_in_currency)
            from public.orders o where o.id = v_order.id);
end $$;

-- ---------------------------------------------------------------------------
-- Changing an order before it is sent: a different size, one more, one fewer.
-- Prices already on the order are kept; new items come in at today's price unless one is given.

create function public.edit_order_items(p_order_id bigint, p_lines jsonb, p_delivery_fee numeric default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o       public.orders;
  v_line  record;
  v_keep  jsonb;
begin
  perform private.require_staff();
  o := private.lock_order(p_order_id, '{new,confirmed}');
  if p_delivery_fee is not null and p_delivery_fee < 0 then
    raise exception 'invalid_order' using detail = 'delivery_fee';
  end if;

  select coalesce(jsonb_object_agg(l.variant_id::text, jsonb_build_object('eur', l.unit_price_eur, 'local', l.unit_price_in_currency)), '{}')
    into v_keep
    from public.order_lines l where l.order_id = o.id;

  for v_line in select * from public.order_lines where order_id = o.id order by variant_id loop
    perform private.apply_stock_movement(v_line.variant_id, 'release', v_line.qty, 'order', o.id, null, 'order changed');
  end loop;
  delete from public.order_lines where order_id = o.id;

  perform private.add_order_lines(o, p_lines, v_keep);
  perform private.recompute_order_totals(o.id, coalesce(p_delivery_fee, o.delivery_fee_in_currency));
end $$;

-- Where it goes, and a note for whoever packs it. Fine to correct until it's delivered.
--   p_details  {delivery_name?, delivery_phone?, delivery_city?, delivery_address?, delivery_postal_code?, delivery_notes?}
create function public.update_order_details(p_order_id bigint, p_details jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o        public.orders;
  v_phone  text;
begin
  perform private.require_staff();
  o := private.lock_order(p_order_id, '{new,confirmed,dispatched,delivery_failed}');

  if p_details ? 'delivery_phone' then
    v_phone := private.normalize_phone(p_details ->> 'delivery_phone', o.country);
    if v_phone is null then
      raise exception 'invalid_order' using detail = 'phone';
    end if;
  end if;
  if p_details ? 'delivery_name' and length(trim(coalesce(p_details ->> 'delivery_name', ''))) = 0 then
    raise exception 'invalid_order' using detail = 'first_name';
  end if;
  if p_details ? 'delivery_address' and length(trim(coalesce(p_details ->> 'delivery_address', ''))) = 0 then
    raise exception 'invalid_order' using detail = 'address';
  end if;
  if p_details ? 'delivery_city' and length(trim(coalesce(p_details ->> 'delivery_city', ''))) = 0 then
    raise exception 'invalid_order' using detail = 'city';
  end if;

  update public.orders set
    delivery_name        = case when p_details ? 'delivery_name' then trim(p_details ->> 'delivery_name') else delivery_name end,
    delivery_phone       = coalesce(v_phone, delivery_phone),
    delivery_city        = case when p_details ? 'delivery_city' then trim(p_details ->> 'delivery_city') else delivery_city end,
    delivery_address     = case when p_details ? 'delivery_address' then trim(p_details ->> 'delivery_address') else delivery_address end,
    delivery_postal_code = case when p_details ? 'delivery_postal_code' then nullif(trim(p_details ->> 'delivery_postal_code'), '') else delivery_postal_code end,
    delivery_notes       = case when p_details ? 'delivery_notes' then nullif(trim(p_details ->> 'delivery_notes'), '') else delivery_notes end
  where id = o.id;
end $$;

-- ---------------------------------------------------------------------------
-- The journey

create function public.confirm_order(p_order_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  perform private.lock_order(p_order_id, '{new}');
  update public.orders set status = 'confirmed', confirmed_at = now() where id = p_order_id;
end $$;

-- Before it leaves: the stock goes back on sale.
create function public.cancel_order(p_order_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o       public.orders;
  v_line  record;
begin
  perform private.require_staff();
  o := private.lock_order(p_order_id, '{new,confirmed}');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'invalid_order' using detail = 'reason';
  end if;

  for v_line in select * from public.order_lines where order_id = o.id order by variant_id loop
    perform private.apply_stock_movement(v_line.variant_id, 'release', v_line.qty, 'order', o.id, null, 'cancelled');
  end loop;

  perform private.status_note(p_reason);
  update public.orders
     set status = 'cancelled', cancelled_at = now(), cancelled_reason = trim(p_reason)
   where id = o.id;
  perform private.status_note(null);
end $$;

-- Handed to the courier. Each item's cost is frozen on its line now, so restocking
-- later at a different price can't rewrite this order's profit.
create function public.dispatch_order(p_order_id bigint, p_courier text default null, p_tracking text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o       public.orders;
  v_line  record;
begin
  perform private.require_staff();
  o := private.lock_order(p_order_id, '{new,confirmed}');

  for v_line in
    select l.*, v.cost_eur from public.order_lines l join public.variants v on v.id = l.variant_id
     where l.order_id = o.id order by l.variant_id
  loop
    perform private.apply_stock_movement(v_line.variant_id, 'dispatch', v_line.qty, 'order', o.id, v_line.cost_eur);
    update public.order_lines set unit_cost_eur = v_line.cost_eur where id = v_line.id;
  end loop;

  update public.orders
     set status = 'dispatched',
         confirmed_at = coalesce(confirmed_at, now()),
         dispatched_at = now(),
         courier_name = nullif(trim(coalesce(p_courier, '')), ''),
         tracking_ref = nullif(trim(coalesce(p_tracking, '')), '')
   where id = o.id;
end $$;

-- Cash in hand. A delivered order that's paid is complete, and frozen.
create function private.take_payment(p_order_id bigint, p_amount numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'invalid_order' using detail = 'amount';
  end if;
  update public.orders
     set payment_status = 'paid',
         paid_at = now(),
         amount_collected = p_amount,
         status = case when status = 'delivered' then 'completed'::public.order_status else status end
   where id = p_order_id;
end $$;

-- The courier delivered it. Anything the customer handed back at the door is listed
-- in p_refused [{order_line_id, qty}]: it stays on the road until its return is recorded.
-- With p_amount_collected, the cash is recorded too (the usual case: courier reports both at once).
create function public.mark_delivered(
  p_order_id          bigint,
  p_refused           jsonb   default '[]',
  p_amount_collected  numeric default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o          public.orders;
  v_line     record;
  v_refused  int;
  v_kept     int;
  v_any      boolean := false;
begin
  perform private.require_staff();
  o := private.lock_order(p_order_id, '{dispatched,delivery_failed}');

  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_refused, '[]')) r(order_line_id bigint, qty int)
     where r.qty is not null and r.qty > 0
       and not exists (select 1 from public.order_lines l where l.id = r.order_line_id and l.order_id = o.id)
  ) then
    raise exception 'invalid_order' using detail = 'refused';
  end if;

  for v_line in select * from public.order_lines where order_id = o.id order by variant_id loop
    select coalesce(sum(r.qty), 0) into v_refused
      from jsonb_to_recordset(coalesce(p_refused, '[]')) r(order_line_id bigint, qty int)
     where r.order_line_id = v_line.id;

    -- Whatever already came back earlier is no longer on the road.
    v_kept := v_line.qty - v_line.returned_qty - v_refused;
    if v_refused < 0 or v_kept < 0 then
      raise exception 'invalid_order' using detail = 'refused';
    end if;

    if v_kept > 0 then
      perform private.apply_stock_movement(v_line.variant_id, 'deliver', v_kept, 'order', o.id);
      v_any := true;
    end if;
    if v_refused > 0 then
      update public.order_lines set refused_qty = refused_qty + v_refused where id = v_line.id;
    end if;
  end loop;

  if not v_any then
    raise exception 'invalid_order' using detail = 'nothing_delivered';
  end if;

  update public.orders set status = 'delivered', delivered_at = now() where id = o.id;

  if p_amount_collected is not null then
    perform private.take_payment(o.id, p_amount_collected);
  end if;
end $$;

-- Delivered earlier, cash arrives now (couriers often pay out days later).
create function public.record_payment(p_order_id bigint, p_amount numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  perform private.require_staff();
  o := private.lock_order(p_order_id, '{delivered,partially_returned}');
  if o.payment_status <> 'unpaid' then
    raise exception 'invalid_status' using detail = format('order %s is already paid', o.order_number);
  end if;
  perform private.take_payment(o.id, p_amount);
end $$;

-- The courier couldn't deliver. Nothing moves: the parcel is still on the road.
create function public.mark_delivery_failed(p_order_id bigint, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  perform private.lock_order(p_order_id, '{dispatched}');
  perform private.status_note(p_note);
  update public.orders set status = 'delivery_failed' where id = p_order_id;
  perform private.status_note(null);
end $$;

-- The courier tries again.
create function public.retry_delivery(p_order_id bigint, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  perform private.lock_order(p_order_id, '{delivery_failed}');
  perform private.status_note(p_note);
  update public.orders set status = 'dispatched' where id = p_order_id;
  perform private.status_note(null);
end $$;

-- ---------------------------------------------------------------------------
-- Returns
--
-- Anything that comes back: a whole parcel refused or undeliverable, an item handed back
-- at the door, or something the customer sends back after keeping it. Each item is looked
-- at and recorded as saleable (back on the shelf) or damaged (set aside).
--
--   p_lines   [{order_line_id, qty, condition}]
--   p_refund  money given back, in the order's currency (0 when nothing was paid)
--
-- Whether an item comes "off the road" or "from the customer" is worked out here: a parcel
-- never delivered, and items refused at the door, are still in transit; anything else was
-- delivered and is coming back from the customer.

create function public.record_return(
  p_order_id       bigint,
  p_lines          jsonb,
  p_reason         text,
  p_refund         numeric default 0,
  p_refund_method  text    default null,
  p_notes          text    default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  o              public.orders;
  v_return       public.returns;
  v_item         record;
  v_line         public.order_lines;
  v_in_transit   int;
  v_from_customer int;
  v_undelivered  boolean;
  v_refunded     numeric;
  v_paid         numeric;
begin
  perform private.require_staff();
  o := private.lock_order(p_order_id, '{dispatched,delivery_failed,delivered,completed,partially_returned}');
  v_undelivered := o.status in ('dispatched', 'delivery_failed');

  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'invalid_return' using detail = 'reason';
  end if;
  if p_refund is null or p_refund < 0 then
    raise exception 'invalid_return' using detail = 'refund';
  end if;
  if p_refund > 0 and o.payment_status = 'unpaid' then
    raise exception 'invalid_return' using detail = 'nothing was paid, so there is nothing to refund';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'invalid_return' using detail = 'lines';
  end if;

  insert into public.returns (order_id, reason, refund_amount_currency, refund_amount_eur, refund_method, notes)
  values (
    o.id, trim(p_reason), p_refund,
    case when o.currency = 'EUR' then p_refund else round(p_refund / o.currency_per_eur, 2) end,
    nullif(trim(coalesce(p_refund_method, '')), ''), nullif(trim(coalesce(p_notes, '')), '')
  ) returning * into v_return;

  begin
    for v_item in
      select x.order_line_id, x.qty, x.condition
        from jsonb_to_recordset(p_lines) as x(order_line_id bigint, qty int, condition public.return_condition)
       order by x.order_line_id
    loop
      select * into v_line from public.order_lines where id = v_item.order_line_id and order_id = o.id for update;
      if not found or v_item.qty is null or v_item.qty < 1 or v_item.condition is null
         or v_item.qty > v_line.qty - v_line.returned_qty then
        raise exception 'invalid_return' using detail = 'lines';
      end if;

      v_in_transit := case when v_undelivered then v_item.qty else least(v_item.qty, v_line.refused_qty) end;
      v_from_customer := v_item.qty - v_in_transit;

      if v_in_transit > 0 then
        perform private.apply_stock_movement(v_line.variant_id,
          case v_item.condition when 'saleable' then 'return_saleable'::public.movement_type else 'return_damaged'::public.movement_type end,
          v_in_transit, 'return', v_return.id, null, null, true);
      end if;
      if v_from_customer > 0 then
        perform private.apply_stock_movement(v_line.variant_id,
          case v_item.condition when 'saleable' then 'return_saleable'::public.movement_type else 'return_damaged'::public.movement_type end,
          v_from_customer, 'return', v_return.id, null, null, false);
      end if;

      update public.order_lines
         set returned_qty = returned_qty + v_item.qty,
             refused_qty  = refused_qty - case when v_undelivered then 0 else v_in_transit end
       where id = v_line.id;

      insert into public.return_lines (return_id, order_line_id, variant_id, qty, condition)
      values (v_return.id, v_line.id, v_line.variant_id, v_item.qty, v_item.condition);
    end loop;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_return' using detail = 'lines';
  end;

  -- Everything back: returned. Part of a delivered order back: partly returned.
  -- Part of a parcel still on the road back: it carries on as it was.
  perform private.status_note(p_reason);
  if not exists (select 1 from public.order_lines where order_id = o.id and returned_qty < qty) then
    update public.orders set status = 'returned' where id = o.id;
  elsif not v_undelivered then
    update public.orders set status = 'partially_returned' where id = o.id;
  end if;

  if p_refund > 0 then
    select coalesce(sum(refund_amount_currency), 0) into v_refunded from public.returns where order_id = o.id;
    v_paid := coalesce(o.amount_collected, o.total_in_currency);
    if v_refunded > v_paid then
      raise exception 'invalid_return' using detail = 'refund is more than was paid';
    end if;
    update public.orders
       set payment_status = case when v_refunded >= v_paid then 'refunded'::public.payment_status else 'partially_refunded'::public.payment_status end
     where id = o.id;
  end if;
  perform private.status_note(null);

  return v_return.return_number;
end $$;

-- ---------------------------------------------------------------------------
-- Access: staff only. The helpers stay out of reach of every client role.

revoke execute on function private.require_staff() from public;
revoke execute on function private.lock_order(bigint, public.order_status[]) from public;
revoke execute on function private.status_note(text) from public;
revoke execute on function private.add_order_lines(public.orders, jsonb, jsonb) from public;
revoke execute on function private.recompute_order_totals(bigint, numeric) from public;
revoke execute on function private.take_payment(bigint, numeric) from public;

revoke execute on function public.create_manual_order(public.country_code, jsonb, jsonb, numeric, text) from public, anon;
revoke execute on function public.edit_order_items(bigint, jsonb, numeric) from public, anon;
revoke execute on function public.update_order_details(bigint, jsonb) from public, anon;
revoke execute on function public.confirm_order(bigint) from public, anon;
revoke execute on function public.cancel_order(bigint, text) from public, anon;
revoke execute on function public.dispatch_order(bigint, text, text) from public, anon;
revoke execute on function public.mark_delivered(bigint, jsonb, numeric) from public, anon;
revoke execute on function public.record_payment(bigint, numeric) from public, anon;
revoke execute on function public.mark_delivery_failed(bigint, text) from public, anon;
revoke execute on function public.retry_delivery(bigint, text) from public, anon;
revoke execute on function public.record_return(bigint, jsonb, text, numeric, text, text) from public, anon;

grant execute on function public.create_manual_order(public.country_code, jsonb, jsonb, numeric, text) to authenticated;
grant execute on function public.edit_order_items(bigint, jsonb, numeric) to authenticated;
grant execute on function public.update_order_details(bigint, jsonb) to authenticated;
grant execute on function public.confirm_order(bigint) to authenticated;
grant execute on function public.cancel_order(bigint, text) to authenticated;
grant execute on function public.dispatch_order(bigint, text, text) to authenticated;
grant execute on function public.mark_delivered(bigint, jsonb, numeric) to authenticated;
grant execute on function public.record_payment(bigint, numeric) to authenticated;
grant execute on function public.mark_delivery_failed(bigint, text) to authenticated;
grant execute on function public.retry_delivery(bigint, text) to authenticated;
grant execute on function public.record_return(bigint, jsonb, text, numeric, text, text) to authenticated;
