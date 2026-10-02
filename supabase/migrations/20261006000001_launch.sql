-- Launch: the shop's own pages, and a brake on fake orders.

-- ---------------------------------------------------------------------------
-- Words for the About and Delivery & returns pages, edited in Settings.
--
-- Plain text: a blank line starts a new paragraph. The defaults are a starting
-- point for the owners to rewrite in their own words, not a policy.

alter table public.settings
  add column about_text text not null default
    'Hey Chika is a small clothing shop in Prishtina, run by two sisters. We choose every piece ourselves and send it to you anywhere in Kosovo, North Macedonia and Albania.'
    || E'\n\n'
    || 'You pay in cash when your parcel arrives, so there''s nothing to pay online. If you have a question about a size or a colour, send us a message on Instagram.',
  add column returns_text text not null default
    'If something isn''t right, message us within 14 days of delivery and we''ll sort it out with you: a different size, or your money back.'
    || E'\n\n'
    || 'Items need to be unworn and unwashed, with their tags still on. Unless we sent the wrong item or it was faulty, the cost of sending it back is yours.',

  -- Unconfirmed shop orders hold stock until someone calls the customer. Past this
  -- many waiting at once, the shop stops taking new ones (and says to message
  -- instead), so a flood of fake orders can't tie up everything on the shelf.
  add column max_waiting_orders int not null default 50 check (max_waiting_orders > 0);

grant select (about_text, returns_text) on public.settings to anon;

-- ---------------------------------------------------------------------------
-- The brake. place_order already allows only a few waiting orders per phone, but
-- anyone can type a new phone number. This caps the total.
--
-- Only orders placed in the shop: ones the owners type in start confirmed.

create function private.limit_waiting_orders() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_max int;
begin
  select max_waiting_orders into v_max from public.settings;
  if (select count(*) from public.orders where status = 'new') >= coalesce(v_max, 50) then
    raise exception 'shop_busy' using detail = 'too many orders are waiting to be confirmed';
  end if;
  return new;
end $$;

revoke execute on function private.limit_waiting_orders() from public;

create trigger orders_limit_waiting
  before insert on public.orders
  for each row
  when (new.channel = 'online' and new.status = 'new')
  execute function private.limit_waiting_orders();
