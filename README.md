# Hey Chika

Online shop and admin for Hey Chika: women's clothing sold across Kosovo, North Macedonia
and Albania, cash on delivery, from one stock pool in Prishtina.

See [PLAN.md](PLAN.md) for the design and build order.

```
docs/       the original specification documents
supabase/   database: migrations, seed data, demo data, tests
web/        the Angular app: public shop at /, admin at /admin
```

## Status

**Phases 1–8 are done** (foundation, catalogue, barcodes, buying trips, stock, the shop, orders, returns).

- **The shop**, at `/`: browse by category, size and colour; a product page with colour and size
  pickers, photos for the chosen colour, a share button and a link preview for DMs; the bag; and
  checkout, where the customer types their own name, phone and address and pays cash on delivery.
  Prices show in EUR, MKD or ALL depending on the country chosen. Placing an order holds the stock
  for that customer straight away; the last item can't be sold twice. Customers can track an order
  with its number and their phone.
- **Orders** in the admin, grouped by what needs doing: to confirm, to send, on the road, cash due.
  Each order shows its next step: confirm after calling; **pack & send**, scanning each item into the
  parcel so a wrong size is caught before it leaves; delivered (noting anything handed back at the
  door) and the cash collected; not delivered and tried again. Change the items or the address before
  it's sent, or cancel it and the stock goes back on sale. Call, WhatsApp or Viber the customer from
  the order, and copy the address for the courier.
- **New order** for sales agreed in a DM: type the phone and a repeat customer fills in; add items by
  search or by scanning; use a price agreed in the chat, in the customer's currency; free delivery if
  you like. It starts confirmed and holds the stock.
- **Returns:** a refused or undeliverable parcel, an item handed back at the door, or something sent
  back later. Each item goes back on the shelf or is set aside as damaged; money goes back only if it
  was paid.
- **Customers:** everyone who ordered, with what they paid for, parcels that came back, their orders,
  and a note about them
- Full database schema for every phase, with the stock engine, purchasing, costing and checkout
  working and tested (132 database tests)
- Admin login (owners only), phone-first layout, a live "Today" dashboard, Settings (exchange
  rates, delivery fees, shop details)
- **Products:** add a design, tick its colours and sizes to create every SKU and barcode at once,
  set prices, upload photos (shrunk automatically), choose the cover and order
- **Labels:** print barcode stickers on A4 sheets or a label printer roll
- **Scan:** look an item up with a USB/Bluetooth scanner, the phone camera, or by typing its SKU
- **Buying trips:** enter what was bought on a trip (a grid of colours × sizes per design), the trip's
  costs and the exchange rate. It shows what each item will really cost *before* you press Receive;
  receiving puts the items on the shelf and fixes their cost
- **Stock:** what is on the shelf, reserved, on the road and damaged, with filters for what is running
  low or sold out; recount, mark damage and write off with a reason; the full history of every size
- **Categories, colours & sizes:** add new ones without touching code

Still to come: reports and Excel export (phase 9), and launch (10).

### Trying the shop with demo products

To see the whole flow before real stock exists, run `supabase/demo/demo-data.sql` in the SQL Editor. It adds
12 generic designs (plus one hidden draft) with colours, sizes, prices, a sale, a sold-out design and a
spread of stock, received through a real buying trip. There are no photos; the shop shows a letter instead.
Run `supabase/demo/remove-demo-data.sql` before launch to take it all out again, including any test orders
you placed. Both are tested, and the removal only touches designs whose link starts with `demo-`.

### Getting a design into the shop

A design shows in the shop when it is **Active**, **Show in online shop** is ticked, and it has at
least one active size. A size can be ordered only while it has stock, so receive a buying trip (or
recount) first. On the design's page in the admin, **Copy link to send in a DM** gives the link to
paste to a customer.

## First-time setup

Needs Node 22.12 or newer.

### 1. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a project. Pick region
   **Central EU (Frankfurt)**, the closest to the Balkans. Save the database password.
2. **Turn off public sign-ups:** Authentication → Sign In / Providers → untick
   *Allow new users to sign up*. Only the owners should have accounts. (The database refuses
   anyone without a staff profile anyway, but there is no reason to leave the door open.)

### 2. Create the database

In the Supabase dashboard, open **SQL Editor** and run each file in `supabase/migrations/` in
filename order, then `supabase/seed.sql`. **When a new migration file appears (after pulling or after a
new phase), run just the new file the same way.** The app expects the database to be at least as new
as the code.

Or with the Supabase CLI, from the repo root:

```sh
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push --include-seed
```

### 3. Add the two owners

Authentication → Users → **Add user** → *Create new user*, with email and password, and tick
*Auto Confirm User*. Do this for each owner, then in the SQL Editor:

```sql
insert into public.profiles (id, name)
select id, 'Name' from auth.users where email = 'her@email.com';
```

Logging in works only for accounts with a profile row. That row is what makes someone staff.

### 4. Connect the app

Two values go into both files in `web/src/environments/`:

- **Project URL** — `https://<project-id>.supabase.co`. The project ID is under Project Settings →
  General. (Integrations → Data API shows the same URL with `/rest/v1/` on the end; drop that part.)
- **Publishable key** — Project Settings → **API Keys** → the *Publishable and secret API keys*
  tab → under **Publishable key**, the row named `default` → the copy icon. It starts with
  `sb_publishable_`.

These two values are designed to be public — they ship to every visitor's browser. What anyone
can do with them is controlled in the database.

Ignore the **Secret keys** section further down the same page, and the *Legacy anon, service_role*
tab. A secret key bypasses every access rule and must never go in the app.

**Never put the `service_role` / secret key in the app.** It bypasses every access rule.

### 5. Run it

```sh
cd web
npm install
npm start
```

Open http://localhost:4200 for the shop and http://localhost:4200/admin for the admin.

## Tests

```sh
cd supabase/tests && npm install && npm test   # database: runs every migration in a throwaway Postgres
cd web && npm test                             # app screens and logic
cd web && npm run check:barcodes               # printed barcodes scan back to the exact SKU
```

The database tests use [PGlite](https://pglite.dev) (Postgres in WebAssembly) with a small
shim for Supabase's `auth` schema and roles, so they need no Docker and no Supabase project.
PGlite is a single connection, so true concurrent-checkout races can't be simulated here; the
overselling guarantee rests on the `no_overselling` constraint and row locking, which Postgres
enforces regardless of connection count.

## Rules for changing the database

- **Never edit a migration that has been applied.** Add a new one.
- **Stock only changes through `private.apply_stock_movement`.** Nothing writes `stock` or
  `stock_movements` directly — that's what keeps the ledger and the balances in agreement.
- **Orders only move through their functions** (`confirm_order`, `dispatch_order`, `mark_delivered`,
  `record_return` and the rest, in `20261005000001_order_flow.sql`). Each moves the order and its
  stock together; the admin has no direct write access to orders.
- **The shop places orders only through `public.place_order`**, which takes variant ids and
  quantities and works out every price itself. The shop's own total (`bagTotals` in
  `web/src/app/core/money.ts`) must match it exactly, or every order is refused as "price
  changed"; `checkout-parity.test.js` checks the two agree.
- **Each new migration grants its own access.** Migration 6 revokes Supabase's default
  grant-everything, so a new table is invisible to the app until you grant and add policies.
  Fail-closed is deliberate.
- Add a test in `supabase/tests/` for any rule that protects money or stock.

## Deploying

Server rendering only runs for hostnames on an allow-list (Angular's protection against
server-side request forgery). Locally that's `localhost`. In production, set:

```sh
NG_ALLOWED_HOSTS=heychika.com,www.heychika.com
```

Without it the shop still works but silently falls back to rendering in the browser, which is
slower on mobile data.

## Versions

Angular 21 (not 22): Angular 22 needs Node 22.22+, and this machine has 22.17. After updating
Node, `npx ng update @angular/core@22 @angular/cli@22` moves up.

`web/package.json` pins Vite to 7.3.6 through `overrides`. Without it, Vitest pulls in Vite 8,
whose optional peer dependencies crash npm 10's installer. It also pins `piscina` to a patched
version. Remove both overrides once on npm 11 and Angular releases that ship the fixes.
