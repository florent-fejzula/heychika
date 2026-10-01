-- Closing the ways around "receive": a trip becomes real only when receive_purchase
-- says so, because that is what puts the stock on the shelf and fixes the costs.

-- ---------------------------------------------------------------------------
-- Staff set the facts of a trip; the system sets its status and the stored costs.
--
-- Before this, any signed-in staff request could set status = 'received' directly,
-- marking a trip done with no stock added, or write unit_landed_cost_eur by hand.

revoke insert, update on public.purchases from authenticated;
grant insert (reference, supplier_name, purchase_date, currency, currency_per_eur, extra_costs_eur, allocation_method, notes)
  on public.purchases to authenticated;
grant update (reference, supplier_name, purchase_date, currency, currency_per_eur, extra_costs_eur, allocation_method, notes)
  on public.purchases to authenticated;

-- purchase_id and variant_id are included in update because "save these quantities again"
-- is an upsert, which sets every column it was given (to the same values).
revoke insert, update on public.purchase_lines from authenticated;
grant insert (purchase_id, variant_id, qty, unit_price) on public.purchase_lines to authenticated;
grant update (purchase_id, variant_id, qty, unit_price) on public.purchase_lines to authenticated;

-- ---------------------------------------------------------------------------
-- A received trip is a record. The old guard only looked at the trip a line was
-- going *to*, so a line could be moved out of a received trip into a draft (taking
-- it out of the record), or into a received one. It now looks at both.

create or replace function private.guard_received_purchase() returns trigger
language plpgsql as $$
declare
  ids bigint[] := '{}';
begin
  if tg_op in ('UPDATE', 'DELETE') then
    ids := ids || old.purchase_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    ids := ids || new.purchase_id;
  end if;

  if current_setting('heychika.receiving', true) is distinct from 'on'
     and exists (select 1 from public.purchases where id = any (ids) and status = 'received') then
    raise exception 'purchase_received' using detail = 'a received purchase is a permanent record and cannot be edited';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;
