import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, product, variant, move, as } from './harness.js';

const staff = (db, sql, params) => as(db, 'staff', (tx) => one(tx, sql, params));

async function shop() {
  const db = await freshDb();
  const p = await product(db, { name: 'Wrap dress' });
  const m = await variant(db, p, { size: 'M', price: 25 });
  await move(db, m, 'stock_in', 50);
  return { db, m };
}

// A different customer each time, so the per-phone limit never kicks in.
function order(db, m, n) {
  const customer = { first_name: `Test ${n}`, last_name: '', phone: `044 100 ${String(n).padStart(3, '0')}`, city: 'Prishtina', address: 'Street 1' };
  return as(db, 'anon', (tx) =>
    one(tx, 'select place_order($1, $2, $3) r', ['XK', JSON.stringify(customer), JSON.stringify([{ variant_id: m, qty: 1 }])]),
  ).then((row) => row.r);
}

// ---------------------------------------------------------------------------
// The shop's own pages

test('the About and returns words are public, and the owners can rewrite them', async () => {
  const db = await freshDb();
  const seen = await as(db, 'anon', (tx) => one(tx, 'select about_text, returns_text from settings'));
  assert.match(seen.about_text, /Prishtina/);
  assert.match(seen.returns_text, /14 days/);

  await staff(db, `update settings set about_text = 'Two sisters, one shelf.' returning id`);
  assert.equal((await as(db, 'anon', (tx) => one(tx, 'select about_text from settings'))).about_text, 'Two sisters, one shelf.');
});

test('the shop cannot read the order limit, or change the words', async () => {
  const db = await freshDb();
  await assert.rejects(as(db, 'anon', (tx) => tx.query('select max_waiting_orders from settings')), /permission denied/);
  await assert.rejects(as(db, 'anon', (tx) => tx.query(`update settings set about_text = 'hacked'`)), /permission denied/);
  // A logged-in stranger's update matches no rows rather than erroring.
  const r = await as(db, 'stranger', (tx) => tx.query(`update settings set about_text = 'hacked'`));
  assert.equal(r.affectedRows, 0);
  assert.doesNotMatch((await one(db, 'select about_text from settings')).about_text, /hacked/);
});

// ---------------------------------------------------------------------------
// The brake on fake orders

test('past the limit of orders waiting to be confirmed, the shop stops taking more', async () => {
  const { db, m } = await shop();
  await staff(db, 'update settings set max_waiting_orders = 3 returning id');
  for (let n = 1; n <= 3; n++) assert.ok((await order(db, m, n)).order_number);

  await assert.rejects(order(db, m, 4), /shop_busy/);
  assert.equal((await one(db, 'select count(*)::int n from orders')).n, 3, 'nothing half-made');
  assert.equal((await one(db, 'select qty_reserved r from stock where variant_id = $1', [m])).r, 3, 'no stock held for it');

  // Confirming one (after a call) makes room again.
  await staff(db, 'select confirm_order((select min(id) from orders)) r');
  assert.ok((await order(db, m, 5)).order_number);
});

test('the limit never stops the owners typing in an order from a DM', async () => {
  const { db, m } = await shop();
  await staff(db, 'update settings set max_waiting_orders = 1 returning id');
  await order(db, m, 1);
  await assert.rejects(order(db, m, 2), /shop_busy/);

  const r = await staff(db, 'select create_manual_order($1, $2, $3) r', [
    'XK',
    JSON.stringify({ first_name: 'Besa', last_name: 'M', phone: '044 222 333', city: 'Peja', address: 'Street 2' }),
    JSON.stringify([{ variant_id: m, qty: 1 }]),
  ]);
  assert.ok(r.r.order_number);
});

test('the limit is at least one', async () => {
  const db = await freshDb();
  await assert.rejects(staff(db, 'update settings set max_waiting_orders = 0 returning id'), /check constraint/);
});

// ---------------------------------------------------------------------------
// Audit: what the public and logged-in users can reach.
//
// These lists are the whole of it. A new migration that opens anything else to the
// public, or forgets row-level security on a new table, fails here until the list
// is changed on purpose.

const rows = async (db, sql) => (await db.query(sql)).rows;

test('every table has row-level security turned on', async () => {
  const db = await freshDb();
  const open = await rows(db, `
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`);
  assert.deepEqual(open, []);
});

test('the public can read only the catalogue, prices, stock levels and shop settings, and change nothing', async () => {
  const db = await freshDb();
  const columns = await rows(db, `
    select table_name t, privilege_type p, string_agg(column_name, ',' order by column_name) c
      from information_schema.column_privileges
     where grantee = 'anon' and table_schema = 'public'
     group by 1, 2 order by 1, 2`);
  assert.deepEqual(columns, [
    { t: 'categories', p: 'SELECT', c: 'active,code,created_at,id,name,name_sq,size_type,sort_order' },
    { t: 'colors', p: 'SELECT', c: 'active,code,hex,id,name,name_sq,sort_order' },
    { t: 'delivery_zones', p: 'SELECT', c: 'active,country,currency,est_days,fee_eur,free_over_eur' },
    { t: 'product_images', p: 'SELECT', c: 'color_id,created_at,id,is_primary,product_id,sort_order,storage_path' },
    { t: 'products', p: 'SELECT', c: 'brand,category_id,created_at,description,featured,id,material,model_code,name,show_online,slug,status,updated_at' },
    {
      t: 'settings', p: 'SELECT',
      c: 'about_text,all_per_eur,all_rounding,contact_email,contact_phone,facebook_url,id,instagram_url,mkd_per_eur,mkd_rounding,returns_text,store_name,tiktok_url',
    },
    { t: 'sizes', p: 'SELECT', c: 'active,code,id,label,label_sq,size_type,sort_order' },
    { t: 'stock', p: 'SELECT', c: 'qty_available,variant_id' },
    { t: 'variants', p: 'SELECT', c: 'active,color_id,compare_at_price_eur,id,price_eur,product_id,size_id,sku' },
  ]);
});

test('the public can call only checkout, order tracking and price conversion', async () => {
  const db = await freshDb();
  const callable = await rows(db, `
    select p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
  assert.deepEqual(callable.map((r) => r.f), ['local_price', 'place_order', 'track_order']);
  assert.equal((await one(db, `select has_schema_privilege('anon', 'private', 'usage') u`)).u, false);
});

test('logged-in users can call only the staff functions, each of which checks for a staff profile', async () => {
  const db = await freshDb();
  const callable = (await rows(db, `
    select p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`)).map((r) => r.f);
  assert.deepEqual(callable, [
    'cancel_order', 'confirm_order', 'correct_variant_codes', 'create_manual_order', 'dispatch_order', 'edit_order_items',
    'link_barcode', 'local_price', 'mark_delivered', 'mark_delivery_failed', 'place_order', 'receive_purchase',
    'record_payment', 'record_return', 'record_stock_change', 'reorder_images', 'retry_delivery', 'save_trip_item',
    'set_primary_image', 'track_order', 'update_order_details',
  ]);

  // Every one that changes something refuses a logged-in stranger.
  const open = new Set(['local_price', 'place_order', 'track_order']);
  for (const f of callable.filter((name) => !open.has(name))) {
    const { args } = await one(db, `
      select pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = $1`, [f]);
    const nulls = args ? args.split(',').map(() => 'null').join(', ') : '';
    await assert.rejects(as(db, 'stranger', (tx) => tx.query(`select public.${f}(${nulls})`)), /not_authorized|permission denied/, f);
  }
});

test('every function that runs with raised rights pins its search path', async () => {
  const db = await freshDb();
  const loose = await rows(db, `
    select n.nspname || '.' || p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.prosecdef and n.nspname in ('public', 'private')
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
  assert.deepEqual(loose, []);
});
