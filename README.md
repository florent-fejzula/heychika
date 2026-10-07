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

**All ten phases are done.** What's left before opening is outside the code: photos, the owners' own words
on the About and returns pages, a domain, and the checklist under [Going live](#going-live).

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
  working and tested (156 database tests, 320 app tests)
- Admin login (owners only), phone-first layout, a live "Today" dashboard, Settings (exchange
  rates, delivery fees, shop details)
- **Add stock, one form** (Products → *Add product*, Stock → *Add stock*, or *Add item* on a buying trip):
  photos (or paste one with Ctrl+V), name, category, description, material, brand (the ones used before
  are offered), colours, sizes, how many of each, the buying trip, what was paid, and the selling price,
  which is suggested from the real cost (trip costs included) plus the markup in Settings. A trip can be
  made right there without leaving the form. It creates the design, every size with its SKU, and the
  stock in one step. Picking a design that exists restocks it.
- **Barcodes from the tags:** the clothes arrive with barcodes. *Scan the tags* (on a trip or a design) links
  one tag per size to it; after that, scanning any of its tags finds it when packing, looking up or adding
  to an order. Every size also keeps its own SKU, which can be typed instead.
- **Products:** edit a design, its sizes and prices, photos (shrunk automatically), cover and order
- **Labels:** print barcode stickers, only for items that came without a barcode on the tag
- **Scan:** look an item up with a USB/Bluetooth scanner, the phone camera, or by typing its SKU
- **Buying trips:** the trip's costs and exchange rate, then *Add item* for each thing bought. It shows
  what each item will really cost *before* you press Receive; receiving puts the items on the shelf and
  fixes their cost. Saying about how many items the trip brought spreads its costs in the suggested
  prices from the first item on (otherwise they sit on the few entered so far, and no price is filled
  in). Adding straight to stock (no trip) records the cost as typed, through a trip of its own
- **Stock:** what is on the shelf, reserved, on the road and damaged, with filters for what is running
  low or sold out; recount, mark damage and write off with a reason; the full history of every size
- **Categories, colours & sizes:** add new ones without touching code
- **Reports**, under Today, each one downloadable as an Excel file:
  - *Sales*: for this month, last month, this year, last year, all time or chosen dates. Sales, profit, margin
    and the cash that came in (in each currency as it was handed over), by design, category, country, shop or DM,
    and month.
  - *Owed*: what each courier still owes for delivered parcels, what's out for delivery, and what's on its way back.
  - *Stock*: what the shelf is worth at cost and at today's prices, by category and design.
  - *Buying*: what each trip and supplier cost, and what an item cost on average with the trip costs.

  A sale counts on the day its cash is recorded, less anything that came back since. Each item counts at the price
  the customer paid in their currency, turned into euros at the order's own rate, against what it cost when it was
  sent. Delivery fees are cash in but not sales. The order page's profit is worked out the same way.
- **Shop pages:** About us, and Delivery & returns (fees for each country in its own money, how paying works,
  the returns policy). The owners write the words in Settings. Dead links answer "not found" (404).
- **A brake on fake orders:** past 50 shop orders waiting to be confirmed (changeable in Settings), the shop
  pauses and asks customers to message instead, so nobody can tie up the stock with made-up orders. Today
  says when it's paused. Orders typed in from a DM are never stopped.
- **English and Albanian:** the flag at the top right of the shop and the admin switches every screen
  at once, and the choice is remembered (a `lang` cookie, so the server renders pages in it too). The
  first visit follows the browser’s language. The words are in `web/src/i18n/en.json` and `sq.json`,
  one key per sentence ([Transloco](https://jsverse.gitbook.io/transloco)); `npm run check:i18n`
  checks both files have every key the code uses. Categories, colours and sizes have an Albanian name
  beside the English one (Lists screen; empty means the shop shows the English). Links and filters
  keep using the English name. Other text the owners type (product names, delivery times, the About
  and Returns text) shows as they wrote it.
- **“A new version is available”:** after a release, a page left open (a phone resumes tabs for days)
  offers a Refresh. The server reports its build at `/app-version`; the app asks when it comes back to
  the screen and every half hour.
- **Nightly encrypted backups** of the database and every photo (see [Backups](#backups))

### Trying the shop with demo products

To see the whole flow before real stock exists, run `supabase/demo/demo-data.sql` in the SQL Editor. It adds
12 generic designs (plus one hidden draft) with colours, sizes, prices, a sale, a sold-out design and a
spread of stock, received through a real buying trip. There are no photos; the shop shows a letter instead.
Run `supabase/demo/remove-demo-data.sql` before launch to take it all out again, including any test orders
you placed. Both are tested, and the removal only touches designs whose link starts with `demo-`.

### Getting a design into the shop

*Add stock* puts a new product in the shop straight away, unless *Show it in the online shop* is
unticked. Otherwise a design shows in the shop when it is **Active**, **Show in online shop** is ticked,
and it has at least one active size; a size can be ordered only while it has stock. On the design's page
in the admin, **Copy link to send in a DM** gives the link to paste to a customer.

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
cd web && npm run check:i18n                   # every translation key exists in English and Albanian
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
- **What the public can reach is listed in `launch.test.js`**: every table, column and function the shop
  can see or call, and the staff functions. A migration that opens anything else, or leaves row-level
  security off a new table, fails those tests. When opening something is deliberate, change the list in
  the same commit.
- Add a test in `supabase/tests/` for any rule that protects money or stock.

## Going live

### Hosting

The shop is a Node server (`web/src/server.ts`: Express plus Angular's server rendering), so it needs a host
that runs Node, not a static host. **Firebase App Hosting** runs it as it is: create a backend, connect this
GitHub repository, set the app root directory to `web`, and every push to `main` deploys. It needs the
Blaze (pay-as-you-go) plan, but a shop this size stays inside the free monthly allowance. Any other Node
host works too: build with `npm run build` and run `node dist/web/server/server.mjs` (it listens on `PORT`).

Server rendering only runs for hostnames on an allow-list (Angular's protection against server-side
request forgery). Locally that's `localhost`. On the host, set this environment variable to the shop's
domain and the host's own address:

```sh
NG_ALLOWED_HOSTS=heychika.com,www.heychika.com,<the address the host gives you>
```

Without it the shop still works but silently falls back to rendering in the browser, which is slower on
mobile data, and product links pasted into a DM lose their preview.

### Checklist

1. **Database up to date:** every file in `supabase/migrations/` has been run, in order.
2. **Demo products gone:** run `supabase/demo/remove-demo-data.sql` if the demo was ever loaded.
3. **Settings:** today's exchange rates, the delivery fee and days for each country, the phone (with its
   country code, so WhatsApp and Viber links work), email and social links.
4. **Shop pages:** rewrite About us and Returns in Settings in the owners' own words. The returns text
   that ships is only a starting point: decide how many days, what condition, and who pays to send it back.
5. **Supabase → Authentication → URL Configuration:** set the Site URL to the shop's address.
6. **Sign-ups off** (see setup step 1) and each owner has a strong password.
7. **Backups set up** (below), and one run by hand from the Actions tab that went green.
8. **One real order end to end:** place it on a phone, confirm it, pack it by scanning, mark it delivered with
   the cash, and see it in Reports. Then cancel or return it.

Supabase pauses a free project after a week with no activity. A live shop has visitors every day, so that
only matters before launch: open the admin now and then until it's live.

## Backups

Supabase's free plan keeps no backups. `.github/workflows/backup.yml` makes one every night: the whole
database (in the format Supabase's own backup guide uses) and every product photo, packed, **encrypted**,
and kept for 30 days as a download on the workflow run. The repository is public, so the encryption is what
keeps customers' names and addresses private: without the passphrase the file is noise.

**Setting it up** (once): in GitHub, Settings → Secrets and variables → Actions → *New repository secret*:

- `SUPABASE_DB_URL`: in Supabase, **Connect** (top of the dashboard) → *Session pooler* → the URI, with
  the database password filled in. (The pooler one, because GitHub's machines can't reach the direct
  address.)
- `BACKUP_PASSPHRASE`: a long passphrase. **Keep it somewhere safe outside GitHub** (a password manager):
  without it no backup can be opened, and GitHub won't show it to you again.

Then Actions → *Nightly backup* → *Run workflow*, and check it goes green with a download at the bottom.
GitHub emails if a night fails.

**Restoring** (Git Bash has `gpg`; `psql` comes with PostgreSQL):

```sh
gpg -d heychika-2026-10-02.tar.gz.gpg > backup.tar.gz   # asks for the passphrase
tar -xzf backup.tar.gz                                    # makes backup/
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file backup/roles.sql --file backup/schema.sql \
  --command 'SET session_replication_role = replica' \
  --file backup/data.sql --dbname "<a new, empty Supabase project's connection URI>"
```

Then upload what's in `backup/photos/` into the new project's `product-images` bucket (Storage in the
dashboard), keeping the folders, and point the app at the new project (setup step 4). Check the owners can
log in; if not, add them again (setup step 3). Restore into a new project rather than over the live one, so
nothing is lost if it goes wrong.

Paying for Supabase Pro adds daily backups of its own, with a restore button; this workflow is the free
equivalent.

## Versions

Angular 21 (not 22): Angular 22 needs Node 22.22+, and this machine has 22.17. After updating
Node, `npx ng update @angular/core@22 @angular/cli@22` moves up.

`web/package.json` pins Vite to 7.3.6 through `overrides`. Without it, Vitest pulls in Vite 8,
whose optional peer dependencies crash npm 10's installer. It also pins `piscina` to a patched
version. Remove both overrides once on npm 11 and Angular releases that ship the fixes.
