import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, product, variant, move, as } from './harness.js';

async function shopWithOneOnlineAndOneDraft() {
  const db = await freshDb();
  const online = await product(db, { name: 'Online dress', online: true });
  const draft = await product(db, { name: 'Draft dress', online: false });
  const v = await variant(db, online, { price: 39 });
  await variant(db, draft);
  await db.query('update variants set cost_eur = 18 where id = $1', [v]);
  await move(db, v, 'stock_in', 3);
  return { db, online, draft, v };
}

// ---------------------------------------------------------------------------
// The public shop

test('shop sees only active, online products', async () => {
  const { db } = await shopWithOneOnlineAndOneDraft();
  const { rows } = await as(db, 'anon', (tx) => tx.query('select name from products'));
  assert.deepEqual(rows.map((r) => r.name), ['Online dress']);
});

test('shop can read prices and availability', async () => {
  const { db, v } = await shopWithOneOnlineAndOneDraft();
  const row = await as(db, 'anon', (tx) =>
    one(tx, 'select v.sku, v.price_eur, s.qty_available from variants v join stock s on s.variant_id = v.id where v.id = $1', [v]));
  assert.equal(Number(row.price_eur), 39);
  assert.equal(row.qty_available, 3);
});

test('shop can never read what they paid for stock', async () => {
  const { db, v } = await shopWithOneOnlineAndOneDraft();
  await assert.rejects(as(db, 'anon', (tx) => tx.query('select cost_eur from variants where id = $1', [v])), /permission denied/);
  await assert.rejects(as(db, 'anon', (tx) => tx.query('select * from variants')), /permission denied/);
  await assert.rejects(as(db, 'anon', (tx) => tx.query('select default_markup_pct from settings')), /permission denied/);
  await assert.rejects(as(db, 'anon', (tx) => tx.query('select qty_physical from stock')), /permission denied/);
});

test('shop sees nothing of customers, orders, purchases or the ledger', async () => {
  const { db } = await shopWithOneOnlineAndOneDraft();
  for (const table of ['customers', 'orders', 'order_lines', 'purchases', 'purchase_lines', 'stock_movements', 'profiles', 'returns']) {
    await assert.rejects(as(db, 'anon', (tx) => tx.query(`select 1 from ${table}`)), /permission denied/, table);
  }
});

test('shop cannot change anything', async () => {
  const { db, v } = await shopWithOneOnlineAndOneDraft();
  await assert.rejects(as(db, 'anon', (tx) => tx.query('update variants set price_eur = 1 where id = $1', [v])), /permission denied/);
  await assert.rejects(as(db, 'anon', (tx) => tx.query(`insert into categories (code, name) values ('ZZ', 'x')`)), /permission denied/);
});

test('shop cannot call staff functions or the stock engine', async () => {
  const { db, v } = await shopWithOneOnlineAndOneDraft();
  await assert.rejects(
    as(db, 'anon', (tx) => tx.query(`select record_stock_change($1, 'adjust', 100, 'free dresses')`, [v])),
    /permission denied/);
  await assert.rejects(as(db, 'anon', (tx) => tx.query('select receive_purchase(1)')), /permission denied/);
  await assert.rejects(
    as(db, 'anon', (tx) => tx.query(`select private.apply_stock_movement($1, 'stock_in', 100)`, [v])),
    /permission denied/);
});

test('shop shows local prices rounded up to clean numbers', async () => {
  const db = await freshDb();
  const price = async (eur, cur) =>
    Number((await as(db, 'anon', (tx) => one(tx, 'select local_price($1, $2) p', [eur, cur]))).p);
  assert.equal(await price(25, 'EUR'), 25);
  assert.equal(await price(25, 'MKD'), 1550, '25 x 61.5 = 1537.50 -> 1550');
  assert.equal(await price(25, 'ALL'), 2500, '25 x 98 = 2450 -> 2500');
  assert.equal(await price(20, 'MKD'), 1250, '20 x 61.5 = 1230 -> 1250');
});

// ---------------------------------------------------------------------------
// Logged in, but not staff

test('a logged-in stranger without a profile sees nothing at all', async () => {
  const { db } = await shopWithOneOnlineAndOneDraft();
  const { rows } = await as(db, 'stranger', (tx) => tx.query('select * from products'));
  assert.equal(rows.length, 0);
  const { rows: s } = await as(db, 'stranger', (tx) => tx.query('select * from stock'));
  assert.equal(s.length, 0);
  await assert.rejects(
    as(db, 'stranger', (tx) => tx.query(`select record_stock_change(1, 'adjust', 5, 'x')`)),
    /not_authorized/);
});

// ---------------------------------------------------------------------------
// Staff

test('staff see everything, including drafts and cost', async () => {
  const { db, v } = await shopWithOneOnlineAndOneDraft();
  const { rows } = await as(db, 'staff', (tx) => tx.query('select name from products order by name'));
  assert.deepEqual(rows.map((r) => r.name), ['Draft dress', 'Online dress']);
  const row = await as(db, 'staff', (tx) => one(tx, 'select cost_eur from variants where id = $1', [v]));
  assert.equal(Number(row.cost_eur), 18);
});

test('staff can manage the catalogue', async () => {
  const db = await freshDb();
  await as(db, 'staff', async (tx) => {
    await tx.query(`insert into categories (code, name) values ('BL', 'Blazers')`);
    const p = await one(tx, `insert into products (category_id, name, slug)
                             values ((select id from categories where code = 'BL'), 'Linen blazer', 'linen-blazer')
                             returning id, model_code`);
    assert.equal(p.model_code, '001');
    const v = await one(tx, `insert into variants (product_id, color_id, size_id, price_eur)
                             values ($1, (select id from colors where code = 'BEI'), (select id from sizes where code = 'S'), 45)
                             returning sku`, [p.id]);
    assert.equal(v.sku, 'BL-001-BEI-S');
  });
});

test('staff cannot set stock quantities directly, only through the engine', async () => {
  const { db, v } = await shopWithOneOnlineAndOneDraft();
  await assert.rejects(as(db, 'staff', (tx) => tx.query('update stock set qty_physical = 100 where variant_id = $1', [v])), /permission denied/);
  await assert.rejects(
    as(db, 'staff', (tx) => tx.query(`insert into stock_movements (variant_id, type, qty, delta_physical, delta_reserved, delta_in_transit, delta_damaged) values ($1, 'stock_in', 1, 1, 0, 0, 0)`, [v])),
    /permission denied/);
  await assert.rejects(as(db, 'staff', (tx) => tx.query('update variants set cost_eur = 1 where id = $1', [v])), /permission denied/);
});

test('staff can set the low-stock threshold', async () => {
  const { db, v } = await shopWithOneOnlineAndOneDraft();
  await as(db, 'staff', (tx) => tx.query('update stock set min_stock = 2 where variant_id = $1', [v]));
  assert.equal((await one(db, 'select min_stock from stock where variant_id = $1', [v])).min_stock, 2);
});

test('staff manual stock changes need a reason and are limited to corrections', async () => {
  const { db, v } = await shopWithOneOnlineAndOneDraft();
  await as(db, 'staff', (tx) => tx.query(`select record_stock_change($1, 'adjust', -1, 'stocktake: one missing')`, [v]));
  assert.equal((await one(db, 'select qty_physical from stock where variant_id = $1', [v])).qty_physical, 2);

  await assert.rejects(as(db, 'staff', (tx) => tx.query(`select record_stock_change($1, 'adjust', 1, '')`, [v])), /invalid_stock_movement/);
  await assert.rejects(
    as(db, 'staff', (tx) => tx.query(`select record_stock_change($1, 'stock_in', 50, 'just because')`, [v])),
    /invalid_stock_movement/, 'stock_in only comes from receiving a purchase');
  await assert.rejects(
    as(db, 'staff', (tx) => tx.query(`select record_stock_change($1, 'reserve', 1, 'x')`, [v])),
    /invalid_stock_movement/, 'reservations only come from orders');

  const m = await one(db, `select note, ref_type from stock_movements where type = 'adjust' and variant_id = $1`, [v]);
  assert.equal(m.note, 'stocktake: one missing');
  assert.equal(m.ref_type, 'adjustment');
});

test('staff can read orders but not write them directly yet', async () => {
  const { db } = await shopWithOneOnlineAndOneDraft();
  await as(db, 'staff', (tx) => tx.query('select * from orders'));
  await assert.rejects(as(db, 'staff', (tx) => tx.query(`update orders set status = 'dispatched'`)), /permission denied/);
});
