// The demo data (supabase/demo/) is run by hand in the SQL Editor, so it needs to be right first time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshDb, one, product, variant, purchase, receive, move, as } from './harness.js';

const demoDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo');
const load = (file) => readFileSync(join(demoDir, file), 'utf8');
const ADD = load('demo-data.sql');
const REMOVE = load('remove-demo-data.sql');

const arta = { first_name: 'Arta', last_name: 'K', phone: '044 123 456', city: 'Prishtina', address: 'Rr. Agim Ramadani 1' };
const count = async (db, table) => (await one(db, `select count(*)::int n from ${table}`)).n;

test('the demo fills the shop with designs the public can see, with real costs and stock', async () => {
  const db = await freshDb();
  await db.exec(ADD);

  const seen = await as(db, 'anon', (tx) => tx.query('select name, featured from products order by id'));
  assert.equal(seen.rows.length, 12, 'twelve designs; the draft one is hidden');
  assert.ok(!seen.rows.some((r) => /Draft/.test(r.name)));
  assert.ok(seen.rows.some((r) => r.featured));

  assert.equal((await one(db, `select count(*)::int n from products where slug like 'demo-%'`)).n, 13);
  assert.equal((await one(db, `select status from purchases where reference like 'DEMO%'`)).status, 'received');

  // Costs came from a real receive: below the price, landed costs filled in.
  const margin = await one(db, `select count(*)::int n from variants v where v.cost_eur > 0 and v.cost_eur < v.price_eur`);
  assert.ok(margin.n > 50);

  // A spread of stock: some sold out, some nearly, some plenty.
  const levels = await as(db, 'anon', (tx) => tx.query('select qty_available a from stock'));
  const avail = levels.rows.map((r) => r.a);
  assert.ok(avail.includes(0) && avail.includes(1) && avail.includes(2) && avail.some((a) => a >= 5));

  // One design is wholly sold out and one is on sale.
  assert.equal((await one(db, `
    select sum(s.qty_physical)::int n from stock s join variants v on v.id = s.variant_id
      join products p on p.id = v.product_id where p.slug = 'demo-floral-summer-dress'`)).n, 0);
  assert.ok((await one(db, `select count(*)::int n from variants where compare_at_price_eur > price_eur`)).n > 0);
});

test('running the demo twice changes nothing the second time', async () => {
  const db = await freshDb();
  await db.exec(ADD);
  const before = [await count(db, 'products'), await count(db, 'variants'), await count(db, 'stock_movements')];
  await db.exec(ADD);
  assert.deepEqual([await count(db, 'products'), await count(db, 'variants'), await count(db, 'stock_movements')], before);
});

test('the demo explains itself if the owners have not been added yet', async () => {
  const db = await freshDb();
  await db.exec('delete from profiles');
  await assert.rejects(db.exec(ADD), /profiles first/);
  assert.equal(await count(db, 'products'), 0, 'nothing half-made');
});

test('an order can be placed on a demo design, and removing the demo takes it away too', async () => {
  const db = await freshDb();
  await db.exec(ADD);
  const v = (await one(db, `
    select v.id from variants v join stock s on s.variant_id = v.id join products p on p.id = v.product_id
     where p.slug = 'demo-ribbed-knit-top' and s.qty_available >= 2 limit 1`)).id;
  const r = await as(db, 'anon', (tx) =>
    one(tx, 'select place_order($1, $2, $3) r', ['XK', JSON.stringify(arta), JSON.stringify([{ variant_id: v, qty: 2 }])]));
  assert.ok(r.r.order_number);
  assert.equal(await count(db, 'orders'), 1);

  await db.exec(REMOVE);
  for (const t of ['orders', 'order_lines', 'order_status_history', 'customers', 'products', 'variants', 'stock', 'stock_movements', 'purchases', 'purchase_lines']) {
    assert.equal(await count(db, t), 0, t);
  }
});

test('removing the demo leaves real products, trips, orders and customers alone', async () => {
  const db = await freshDb();
  const p = await product(db, { name: 'Real dress' });
  const real = await variant(db, p, { price: 40 });
  await receive(db, await purchase(db, [[real, 5, 10]]));
  await db.exec(ADD);

  const customer = { ...arta, phone: '070 111 222' };
  const order = await as(db, 'anon', (tx) =>
    one(tx, 'select place_order($1, $2, $3) r', ['MK', JSON.stringify(customer), JSON.stringify([{ variant_id: real, qty: 1 }])]));

  await db.exec(REMOVE);

  assert.equal((await one(db, 'select name from products')).name, 'Real dress');
  assert.equal(await count(db, 'variants'), 1);
  assert.equal((await one(db, 'select qty_physical p, qty_reserved r from stock')).p, 5);
  assert.equal(await count(db, 'purchases'), 1, 'the real trip stays');
  assert.equal(await count(db, 'customers'), 1);
  assert.equal((await one(db, 'select order_number n from orders')).n, order.r.order_number);
  assert.equal(await count(db, 'stock_movements'), 2, 'real receive and the real order reservation');
});

test('removing the demo turns the safety triggers back on', async () => {
  const db = await freshDb();
  await db.exec(ADD);
  await db.exec(REMOVE);

  const p = await product(db);
  const v = await variant(db, p);
  await move(db, v, 'stock_in', 3);
  await assert.rejects(db.query('delete from stock_movements'), /append-only/);
  await assert.rejects(db.query('delete from variants where id = $1', [v]), /variant_locked/);
});

test('the demo can be put back after being removed', async () => {
  const db = await freshDb();
  await db.exec(ADD);
  await db.exec(REMOVE);
  await db.exec(ADD);
  assert.equal(await count(db, 'products'), 13);
});
