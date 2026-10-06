# Hey Chika — Technical Plan

**Status:** draft for review · **Base currency:** EUR · **Stock location:** Prishtina (single pool)
**Markets:** Kosovo (EUR), North Macedonia (MKD), Albania (ALL)
**Scale:** ~50 products now, growing after the Istanbul buying trip

---

## 1. What this is

A web shop plus a mobile-first admin panel for two people selling clothing online across three
countries, cash on delivery, from one stock pool in Prishtina.

Not a company, so: no VAT, no fiscal device, no legal invoices, no card payments. Receipts are
order confirmations, not tax documents.

### Primary goal

Customers enter their own details at checkout. Today both sisters retype everything by hand from
Instagram DMs — removing that is the point of the project, and it drives the build order below.

### Non-goals for v1

Roles and permissions (two users, both owners), CMS, full audit trail, card/bank/mixed payments,
reservation expiry timers, multi-location stock, customer accounts, loyalty, courier APIs.

The schema leaves room for these. None of them is built.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Angular 21 + TypeScript | Known ground; maintainable in 12 months. 22 needs a newer Node |
| Shop rendering | Angular SSR | Load speed on mobile data, not SEO |
| Database | Postgres (Supabase) | Integrity constraints + real reporting |
| Auth / Storage | Supabase | Bundled; Firebase-shaped DX |
| Images | Supabase Storage + transforms | Resizing without a separate service |
| Hosting | Firebase App Hosting (any Node host works) | Runs the SSR server as it is; known ground. Static hosts (Vercel, Cloudflare Pages) can't run it unchanged |
| Barcodes | `bwip-js` (render), `@zxing/browser` (scan) | Cross-platform; works on iOS Safari |

**On Firestore:** rejected for this project, not on principle. Two reasons. The rules this app
lives on — unique SKU, unique barcode, stock never negative — are one database line each in
Postgres and hand-written application code in Firestore, in every path that touches stock, forever.
And reporting ("profit by category by month") is a short query here versus a Cloud Function that
walks documents and aggregates in memory.

---

## 3. Data model

### Catalogue

```
categories      id, code (DR/PN/SK), name, size_type (letter|numeric|one_size),
                sort_order, active

colors          id, code (BLK), name, hex          -- hex drives shop swatches
sizes           id, code (M / 38 / OS), label, size_type, sort_order
                                                   -- sort_order so S,M,L don't sort alphabetically

products        id, category_id, model_code, name, description, material, brand,
                status (draft|active|archived), show_online, featured,
                created_at, updated_at
                UNIQUE (category_id, model_code)

variants        id, product_id, color_id, size_id,
                sku, barcode,
                cost_eur,            -- weighted average, maintained on each receive
                price_eur, compare_at_price_eur,
                locked,              -- true once used in any transaction
                active, created_at
                UNIQUE (sku), UNIQUE (barcode), UNIQUE (product_id, color_id, size_id)

product_images  id, product_id, color_id NULL, url, sort_order, is_primary
                -- color_id so picking a colour shows that colour's photos
```

`products` is the design ("black satin wrap dress"). `variants` is the thing with a barcode and a
stock count. **Two different black dresses in M are two products, not one** — this is the
uniqueness problem the SKU scheme exists to solve.

### SKU and barcode

```
SKU      {category.code}-{model_code}-{color.code}-{size.code}
         DR-001-BLK-M

barcode  Code128, encoding the SKU directly
```

She types a human name; the system assigns `model_code` as the next sequence in that category and
generates SKU and barcode. No prefix library to memorise.

Code128 over EAN-13 because EAN-13 needs a real GS1 prefix to be globally valid, and that only
matters if the goods pass through another retailer's till. These don't. The scanner returns the SKU
as plain text, so lookup is a single indexed query, and the SKU prints human-readable under the bars.

The first stock movement sets `variants.locked`, and from then on the database refuses edits to
SKU, barcode, product, colour and size. Fixing a genuinely wrong one goes through
`correct_variant_codes()`, which requires a reason and keeps the old values in
`variant_code_changes`. The product's category and model code freeze too, since both are baked
into its SKUs.

### Stock

```
stock           variant_id PK,
                qty_physical, qty_reserved, qty_in_transit, qty_damaged,
                qty_available GENERATED ALWAYS AS (qty_physical - qty_reserved) STORED,
                min_stock, updated_at

                CHECK (qty_physical   >= 0)
                CHECK (qty_reserved   >= 0)
                CHECK (qty_in_transit >= 0)
                CHECK (qty_damaged    >= 0)
                CHECK (qty_physical   >= qty_reserved)   <-- overselling is impossible
```

That last constraint is the most important line in the schema. Two customers racing for the last
dress: the second transaction fails at the database, not in application logic someone might forget
to write. Reserve inside a transaction with `SELECT ... FOR UPDATE` on the stock row.

### Stock ledger

```
stock_movements id, variant_id, type, qty,
                delta_physical, delta_reserved, delta_in_transit, delta_damaged,
                ref_type (purchase|order|return|adjustment), ref_id,
                unit_cost_eur NULL, note, user_id, created_at
```

Append-only. Never updated, never deleted. Explicit deltas mean any balance can be replayed and
verified from the ledger, which is the audit trail for the only thing that really needs one.

Movement types: `stock_in`, `reserve`, `release`, `dispatch`, `deliver`, `return_saleable`,
`return_damaged`, `adjust`, `mark_damaged`, `writeoff`.

| Event | physical | reserved | in_transit | damaged |
|---|---|---|---|---|
| Stock received | +qty | — | — | — |
| Order placed | — | +qty | — | — |
| Cancelled before dispatch | — | −qty | — | — |
| Dispatched | −qty | −qty | +qty | — |
| Delivered | — | — | −qty | — |
| Delivery failed | — | — | *(stays)* | — |
| Refused parcel back, saleable | +qty | — | −qty | — |
| Refused parcel back, damaged | — | — | −qty | +qty |
| Customer returns after delivery, saleable | +qty | — | — | — |
| Customer returns after delivery, damaged | — | — | — | +qty |
| Damage found on the shelf | −qty | — | — | +qty |
| Damaged stock disposed of | — | — | — | −qty |
| Stock count correction | ±qty | — | — | — |

The original spec only covered returns of parcels that were never delivered. Clothing customers
also send things back *after* delivery, when the item is no longer in transit, so returns take a
`from_transit` flag. "Damage found on the shelf" was also missing — a stain spotted before
anything was sold.

**Why `in_transit` exists:** COD clothing, three borders, no try-on. Refused deliveries are routine.
A refused parcel is gone from the shelf but not gone from the business — without this bucket it
disappears from the system for the days or weeks it takes to physically come back.

**Delivery failed deliberately moves nothing.** Goods stay in transit until they are physically
back in Prishtina and someone has looked at them.

### Purchases and costing

```
purchases       id, reference ("Istanbul Oct 2026"), supplier_name,
                purchase_date, currency (EUR|USD|TRY), currency_per_eur,
                extra_costs_eur,                  -- travel, freight, customs for the whole trip
                allocation_method (by_quantity|by_value),
                status (draft|received), notes, created_at

purchase_lines  id, purchase_id, variant_id, qty,
                unit_price, unit_price_eur,
                allocated_extra_eur, unit_landed_cost_eur
```

On **receive**, per line:

```
unit_landed_cost_eur = unit_price_eur + allocated_extra_eur

cost_eur = (cost_eur * qty_on_hand + unit_landed_cost_eur * qty_received)
           / (qty_on_hand + qty_received)
```

Buy 80 items, trip costs €400 → €5 lands on each. Without it they don't know their real margin.

The incremental form above *is* weighted average cost, and it's three lines rather than the
subsystem the original spec implied. Worth keeping.

### Orders

```
orders          id, order_number (HC-2026-0001), customer_id,
                channel (online|manual),
                status, payment_status,
                country (XK|MK|AL), currency (EUR|MKD|ALL), currency_per_eur,
                subtotal_eur, delivery_fee_eur, discount_eur, total_eur,
                total_in_currency,                -- what the courier collects
                amount_collected NULL,
                delivery_method, courier_name, tracking_ref, delivery_notes,
                delivery_name, delivery_phone, delivery_city, delivery_address,
                delivery_postal_code,            -- where this parcel goes, as typed at checkout
                delivery_fee_in_currency,
                dispatched_at, delivered_at, paid_at, completed_at,
                cancelled_reason, locked, created_at, updated_at

order_lines     id, order_id, variant_id,
                sku_snapshot, product_name_snapshot, color_snapshot, size_snapshot,
                qty, unit_price_eur, default_price_eur, discount_eur, line_total_eur,
                unit_price_in_currency,           -- the price the customer saw
                unit_cost_eur NULL,               -- frozen at dispatch
                returned_qty

order_status_history
                id, order_id, from_status, to_status,
                from_payment_status, to_payment_status, note, user_id, created_at
```

Three things here are deliberate and easy to get wrong:

1. **Snapshots on order lines.** Product names and prices change. A six-month-old order must still
   read correctly.
2. **`unit_cost_eur` frozen at dispatch.** Cost moves every time they restock. Without freezing,
   restocking silently rewrites the profit on orders already shipped.
3. **Both EUR and local currency on the order.** Books run in EUR; the courier collects MKD, ALL or
   EUR. `currency_per_eur` is snapshotted at order time, because the lek floats and COD cash arrives days
   later.

**Two independent state machines**, not one chain:

```
status           new -> confirmed -> dispatched -> delivered -> completed
                 + cancelled | delivery_failed | returned | partially_returned

payment_status   unpaid -> paid -> (partially_refunded | refunded)

completed  =  delivered AND paid
```

Reserved is not a status — it's the inventory effect of an order existing. `locked` is set at
completion; after that, corrections go through a return, never an edit.

### Returns

```
returns         id, order_id, return_number, reason,
                refund_amount_eur, refund_amount_currency, refund_method,
                user_id, notes, created_at

return_lines    id, return_id, order_line_id, variant_id, qty,
                condition (saleable|damaged)
```

Condition is per line: one parcel can come back with one dress fine and one stained.

### Customers and settings

```
customers       id, first_name, last_name, phone, email NULL,
                country, city, address, postal_code, notes, created_at
                INDEX (phone)

profiles        id (auth uid), name, role       -- single role in v1; column exists for later

settings        single row: store name, logo, contact, social links,
                mkd_per_eur, all_per_eur, fx_updated_at,
                mkd_rounding, all_rounding, default_markup_pct

delivery_zones  country (XK|MK|AL), fee_eur, free_over_eur NULL, est_days, active
```

Phone is the real customer identifier — Instagram customers have phone numbers, not reliably emails.
Indexed so repeat buyers can be found at manual order entry.

**No customer logins in v1.** Guest checkout only; order tracking by order number plus phone.

### Currency display

```
price_local = round_up(price_eur * currency_per_eur, rounding_step)
```

MKD is pegged near 61.5 and barely moves. ALL floats around 97–100 and needs occasional updating.
Round up to the nearest 50 MKD / 100 ALL — a €25 dress shown as "1537.50 MKD" looks broken.

---

## 4. Screens

### Admin — mobile first, non-negotiable

They work from their phones with a DM open in the other app. Desktop is the secondary case.

1. Login
2. Dashboard — today's orders, unpaid, low stock, stock value
3. Products list + search
4. Product editor — details, images, and a colour × size grid for generating variants in bulk
5. Label sheet — printable barcode stickers, A4
6. Purchases list
7. Purchase entry — lines, trip costs, allocation, receive
8. Stock — scan or search to look up, adjust, write off
9. Orders list — filtered by status
10. Order detail — advance status, scan-to-dispatch, record COD collection
11. Manual order entry — the DM fallback, built for speed
12. Returns
13. Customers — phone lookup, order history
14. Reports + Excel export
15. Settings — FX rates, delivery fees, social links

### Shop — mobile first

1. Home — featured, new arrivals
2. Category listing — filter by colour, size, price
3. Product page — colour and size picker, images, availability, **share button**
4. Cart
5. Checkout — country sets currency and delivery fee; name, phone, address; COD
6. Confirmation + tracking by order number and phone
7. Static pages — about, delivery & returns, contact

**Built:** all seven. About and Delivery & returns are two pages (contact details sit on About); their
words are edited in Settings. Home and category listing are one page, filtered by category, size and colour
(not price: with ~50 designs it adds little). A size or colour filter shows only what is in stock
in it.

**The share button matters more than it looks.** Customers live in Instagram DMs and won't all move
to a website. The realistic flow for a long time is: customer DMs, sister pastes a product link,
customer checks out themselves. That link is the bridge off manual entry.

### Where scanning fits

1. **Stock-in** — scan as items are unpacked
2. **Dispatch** — scan the garment to confirm the right variant *and* move the stock in one action
3. **Lookup** — scan anything to see what it is and what's left

Point 2 is the valuable one: it catches a wrong-size pick before the parcel crosses a border to a
COD customer who will refuse it.

A phone camera works via `@zxing/browser`. A €25 Bluetooth scanner acts as a keyboard and needs no
code at all — just a focused input.

**Built so far:** lookup (point 3) and dispatch (point 2: Pack & send on each order; an item that
isn't in the order is refused loudly), plus adding items to a hand-typed order by scanning. Stock-in
is by the Add item form, which is faster than scanning one item at a time.

**The clothes arrive with barcodes on their tags** (the supplier's, usually EAN-13), so nothing gets
printed or stuck. *Scan the tags* links one tag per size to that size (`link_barcode`): the variant's
`barcode` takes the tag's code, its SKU stays. One code, one size: a code already on another size is
refused, which is also how a supplier that prints the same code on every size would show up. Labels
remain for anything that comes without a tag; they need to be at least ~45 mm wide to scan reliably
(measured; see `web/scripts/check-barcodes.mjs`), so the label sizes offered stop there.

**Adding stock is one form** (`save_trip_item`): design, sizes and quantities in one call, onto a draft
trip or, with no trip, straight onto the shelf through a trip of its own ("Added by hand") that is
received at once, so cost and history work the same way. The first version made her create the design,
then its sizes, then open the trip and pick the design: five screens for one bag of clothes.

---

## 5. Build order

Dependencies force catalogue and stock before the shop, but the shop comes before the manual-entry
screen, because self-service checkout is the actual goal.

| Phase | Scope |
|---|---|
| 1 ✅ | Foundation — schema, Supabase, auth, deploy pipeline, settings |
| 2 ✅ | Catalogue — categories, colours, sizes, products, variants, SKU generation, images |
| 3 ✅ | Barcodes — generation, printable label sheets, scan lookup |
| 4 ✅ | Purchases — trip entry, landed cost, receive into stock |
| 5 ✅ | Stock engine — ledger, constraints, adjustments, write-offs |
| 6 ✅ | Shop — browse, product page, cart, checkout, order creation |
| 7 ✅ | Order management — status flow, scan-to-dispatch, COD collection |
| 8 ✅ | Returns — refunds, failed delivery, saleable vs damaged |
| 9 ✅ | Reports — stock, sales, profit, Excel export |
| 10 ✅ | Launch — backup, hardening, static pages, social links |

Phases 1–5 are usable internally: real stock, real costs, real margins, before a single customer
sees anything. Phases 6–7 are what she actually asked for.

**Done in phase 1, ahead of schedule:** the whole schema for every phase, plus the stock engine
(phase 5's core) and purchase receiving with landed and weighted-average cost (phase 4's core),
all tested. What remains in phases 4 and 5 is the screens on top.

Rough part-time estimate: **8–12 weeks**. Phases 1–5 are the faster half; phase 6 is the largest
single piece.

---

## 6. Reporting

Default to **paid and completed orders only**. With COD, counting dispatched orders as revenue makes
every report a lie. Dispatched-but-unpaid and delivered-but-unpaid belong in their own list.

- Stock on hand, in transit, damaged, low stock, valuation at `cost_eur`
- Sales by period, category, product, country, channel
- Profit — `revenue − frozen order_lines.unit_cost_eur`
- Purchases by trip and supplier
- Outstanding — dispatched or delivered but unpaid
- Excel export on all of the above

**Built** as four reports under Today: Sales, Owed, Stock, Buying. The rules they follow:

- An order counts on the day its cash was recorded (`paid_at`), in Kosovo time. Returns come off the order
  they belong to, so a month's figures can drop a little when something from it comes back later.
- Sold = `qty − returned_qty − refused_qty`. Each item sells at `unit_price_in_currency / currency_per_eur`
  (what the customer actually paid, rounding included), not the EUR list price. Profit is against the cost
  frozen at dispatch. Items with no cost (counted in, never bought on a trip) are flagged, not hidden.
- Cash in is `amount_collected − refunds`, shown in each currency as handed over and in EUR at the order's
  rate. Delivery fees are in cash, not in sales: they roughly pay the courier.
- Owed splits delivered-unpaid (the courier has the cash) from still-out-for-delivery, and lists what's on its
  way back (undelivered parcels, items handed back at the door).
- Stock is valued at weighted-average cost and at today's price; reserved items are still on the shelf.
- Excel files are written in the browser with no library (`core/xlsx.ts`): SheetJS on npm is unmaintained
  with open advisories, and CSV breaks on these countries' Excel settings (semicolons, ë and ç).

---

## 7. Open questions

1. **Product count** — is "~50" fifty designs or fifty variants? Fifty designs across 2 colours and
   4 sizes is ~400 SKUs. Changes nothing architecturally; changes how bulk variant entry should feel.
2. **Sizes** — numeric (36/38/40) or lettered (S/M/L), or per category? `size_type` handles both;
   need the real starting list.
3. **Couriers** — who actually delivers to each of the three countries, and do they hand back a
   tracking reference worth storing?
4. **Delivery fees** — per country, and is there a free-over threshold?
5. **Istanbul purchases** — quoted in EUR, USD or TRY? Decides whether the purchase exchange rate
   (`currency_per_eur`) gets used in practice.
6. **Returns at whose cost** — who pays return shipping on a refused COD parcel? Affects whether a
   loss needs recording per return.
7. **Shop language** — Albanian, Macedonian, English, or several? Customers span three countries.
   The app is in English for now; this decides whether phase 6 needs translations built in.
8. **Default markup** — the settings start at the original spec's 50%. Is that what they actually
   use? It only suggests prices; every price stays editable.

### Assumptions made

- EUR is the accounting base currency
- Shop in English for now (question 7 is open)
- At most 5 of one size per order, and at most 3 unconfirmed orders per phone per day, so a
  prankster can't tie up the stock with fake orders. Real orders get confirmed by phone anyway.
- A customer is recognised by phone number. The shop never overwrites their saved details (anyone
  can type anyone's number); each order keeps the address that parcel goes to.
- Each price is converted to MKD/ALL and rounded on its own, and the order total is the sum of those,
  so it matches the prices the customer saw item by item
- The shop's country is remembered in a cookie; on a first visit a Macedonian-language browser
  defaults to North Macedonia, anything else to Kosovo
- Reserved stock is held until the order is sent or cancelled; there's no automatic expiry
- An order can be sent straight from "new" (sending it confirms it); it can be cancelled only before
  it's sent. After that, anything that comes back is a return
- An item handed back to the courier at the door stays "on the road" (`order_lines.refused_qty`)
  until its return is recorded in Prishtina and someone has looked at it
- An order delivered and paid is complete and frozen; a return still records what came back
- Refunds are entered in the order's currency, and can't exceed what was collected
- Orders typed in from a DM start confirmed, can include designs not shown online (not retired
  ones), and can use a price agreed in the chat. Staff are trusted with customer details, so a DM
  order updates the customer's saved address; a shop order never does
- At most 50 shop orders waiting to be confirmed at once (changeable in Settings). Past that the shop pauses
  and says to message instead: the per-phone limit alone doesn't stop someone typing new numbers
- The shipped returns text says 14 days, unworn with tags, customer pays return postage unless the item was
  wrong or faulty. It's a placeholder for the owners to rewrite (question 6 is still open)
- Backups are a nightly GitHub Actions job, encrypted because the repository is public, kept 30 days
- Guest checkout only; no customer logins
- Single stock pool, Prishtina
- COD only, collected in the customer's local currency
- Both users are owners with full access

### Not a code problem

Photos will delay launch more than development will. Fifty products needing consistent, decent
photographs is the real bottleneck for any clothing shop. Worth shooting the Istanbul haul properly
as it is unpacked, in parallel with phases 1–5.
