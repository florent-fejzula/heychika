import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, product, variant, purchase, receive, stock } from './harness.js';

const cost = async (db, v) => Number((await one(db, 'select cost_eur from variants where id = $1', [v])).cost_eur);
const line = async (db, purchaseId, v) =>
  one(db, 'select unit_price_eur, allocated_extra_eur, unit_landed_cost_eur from purchase_lines where purchase_id = $1 and variant_id = $2', [purchaseId, v]);

test('receiving adds stock and sets cost to the landed cost', async () => {
  const db = await freshDb();
  const v = await variant(db, await product(db));
  await receive(db, await purchase(db, [[v, 10, 20]]));

  assert.deepEqual(await stock(db, v), { physical: 10, reserved: 0, available: 10, inTransit: 0, damaged: 0 });
  assert.equal(await cost(db, v), 20);
});

test("trip costs spread evenly per item: 80 items, EUR 400 trip -> EUR 5 each", async () => {
  const db = await freshDb();
  const a = await variant(db, await product(db), { size: 'S' });
  const b = await variant(db, await product(db), { size: 'M' });
  const pid = await purchase(db, [[a, 50, 10], [b, 30, 30]], { extra: 400 });
  await receive(db, pid);

  assert.equal(Number((await line(db, pid, a)).allocated_extra_eur), 5);
  assert.equal(Number((await line(db, pid, b)).allocated_extra_eur), 5);
  assert.equal(await cost(db, a), 15);
  assert.equal(await cost(db, b), 35);
});

test('trip costs can be spread by value instead: dearer items carry more', async () => {
  const db = await freshDb();
  const cheap = await variant(db, await product(db), { size: 'S' });
  const dear = await variant(db, await product(db), { size: 'M' });
  // Goods worth 10x20 + 10x40 = 600; extra 60 is 10% of value
  const pid = await purchase(db, [[cheap, 10, 20], [dear, 10, 40]], { extra: 60, method: 'by_value' });
  await receive(db, pid);

  assert.equal(await cost(db, cheap), 22);
  assert.equal(await cost(db, dear), 44);
});

test('Turkish lira purchases convert to EUR at the trip rate', async () => {
  const db = await freshDb();
  const v = await variant(db, await product(db));
  // 45 TRY per EUR: 900 TRY = EUR 20
  const pid = await purchase(db, [[v, 10, 900]], { currency: 'TRY', rate: 45, extra: 30 });
  await receive(db, pid);

  const l = await line(db, pid, v);
  assert.equal(Number(l.unit_price_eur), 20);
  assert.equal(Number(l.allocated_extra_eur), 3);
  assert.equal(Number(l.unit_landed_cost_eur), 23);
  assert.equal(await cost(db, v), 23);
});

test("weighted average: 10 at EUR 20 then 10 at EUR 24 -> EUR 22 (the spec's own example)", async () => {
  const db = await freshDb();
  const v = await variant(db, await product(db));
  await receive(db, await purchase(db, [[v, 10, 20]]));
  await receive(db, await purchase(db, [[v, 10, 24]]));

  assert.equal(await cost(db, v), 22);
  assert.equal((await stock(db, v)).physical, 20);
});

test('weighted average only counts stock still on hand', async () => {
  const db = await freshDb();
  const v = await variant(db, await product(db));
  await receive(db, await purchase(db, [[v, 10, 20]]));
  // Sell 8 (they leave physical stock at dispatch)
  await db.query(`select private.apply_stock_movement($1, 'reserve', 8)`, [v]);
  await db.query(`select private.apply_stock_movement($1, 'dispatch', 8)`, [v]);
  // 2 left at 20, 8 arrive at 30 -> (40 + 240) / 10 = 28
  await receive(db, await purchase(db, [[v, 8, 30]]));

  assert.equal(await cost(db, v), 28);
});

test('the stock-in ledger entry records the landed cost', async () => {
  const db = await freshDb();
  const v = await variant(db, await product(db));
  const pid = await purchase(db, [[v, 4, 10]], { extra: 8 });
  await receive(db, pid);

  const m = await one(db, `select type, qty, ref_type, ref_id, unit_cost_eur from stock_movements where variant_id = $1`, [v]);
  assert.equal(m.type, 'stock_in');
  assert.equal(m.qty, 4);
  assert.equal(m.ref_type, 'purchase');
  assert.equal(Number(m.ref_id), pid);
  assert.equal(Number(m.unit_cost_eur), 12);
});

test('a received purchase cannot be received twice or edited', async () => {
  const db = await freshDb();
  const v = await variant(db, await product(db));
  const pid = await purchase(db, [[v, 10, 20]], { extra: 10 });
  await receive(db, pid);

  await assert.rejects(receive(db, pid), /purchase_received/);
  await assert.rejects(db.query('update purchase_lines set qty = 99 where purchase_id = $1', [pid]), /purchase_received/);
  await assert.rejects(db.query('delete from purchase_lines where purchase_id = $1', [pid]), /purchase_received/);
  await assert.rejects(db.query('update purchases set extra_costs_eur = 0 where id = $1', [pid]), /purchase_received/);
  await assert.rejects(db.query('delete from purchases where id = $1', [pid]), /purchase_received/);

  // Notes are still editable
  await db.query(`update purchases set notes = 'one bag arrived late' where id = $1`, [pid]);
  assert.equal((await stock(db, v)).physical, 10, 'stock was added exactly once');
});

test('an empty purchase cannot be received', async () => {
  const db = await freshDb();
  await assert.rejects(receive(db, await purchase(db, [])), /invalid_purchase/);
});

test('the default markup is the 50% from the spec', async () => {
  const db = await freshDb();
  assert.equal(Number((await one(db, 'select default_markup_pct from settings')).default_markup_pct), 50);
});
