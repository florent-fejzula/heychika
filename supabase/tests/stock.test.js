import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, product, variant, move, stock } from './harness.js';

async function stocked(qty = 10) {
  const db = await freshDb();
  const v = await variant(db, await product(db));
  await move(db, v, 'stock_in', qty);
  return { db, v };
}

test('placing an order reserves stock without removing it from the shelf', async () => {
  const { db, v } = await stocked(10);
  await move(db, v, 'reserve', 2);
  assert.deepEqual(await stock(db, v), { physical: 10, reserved: 2, available: 8, inTransit: 0, damaged: 0 });
});

test('cannot reserve more than is available', async () => {
  const { db, v } = await stocked(3);
  await move(db, v, 'reserve', 2);
  await assert.rejects(move(db, v, 'reserve', 2), /insufficient_stock/);
  assert.deepEqual(await stock(db, v), { physical: 3, reserved: 2, available: 1, inTransit: 0, damaged: 0 },
    'a rejected reservation changes nothing');
});

test('the last unit can be sold exactly once', async () => {
  const { db, v } = await stocked(1);
  await move(db, v, 'reserve', 1);
  await assert.rejects(move(db, v, 'reserve', 1), /insufficient_stock/);
});

test('a count correction cannot take stock below what is already promised to orders', async () => {
  const { db, v } = await stocked(5);
  await move(db, v, 'reserve', 4);
  await assert.rejects(move(db, v, 'adjust', -2), /insufficient_stock/);
  await move(db, v, 'adjust', -1);
  assert.equal((await stock(db, v)).available, 0);
});

test('happy path: reserve -> dispatch -> deliver', async () => {
  const { db, v } = await stocked(10);
  await move(db, v, 'reserve', 2);
  await move(db, v, 'dispatch', 2);
  assert.deepEqual(await stock(db, v), { physical: 8, reserved: 0, available: 8, inTransit: 2, damaged: 0 },
    'dispatch moves reserved stock into transit; available does not drop a second time');

  await move(db, v, 'deliver', 2);
  assert.deepEqual(await stock(db, v), { physical: 8, reserved: 0, available: 8, inTransit: 0, damaged: 0 });
});

test('cancelled before dispatch: the reservation is released', async () => {
  const { db, v } = await stocked(10);
  await move(db, v, 'reserve', 3);
  await move(db, v, 'release', 3);
  assert.deepEqual(await stock(db, v), { physical: 10, reserved: 0, available: 10, inTransit: 0, damaged: 0 });
});

test('refused parcel stays in transit until it is physically back', async () => {
  const { db, v } = await stocked(5);
  await move(db, v, 'reserve', 1);
  await move(db, v, 'dispatch', 1);
  // Delivery fails: nothing moves. Goods are still somewhere between here and the customer.
  assert.deepEqual(await stock(db, v), { physical: 4, reserved: 0, available: 4, inTransit: 1, damaged: 0 });

  await move(db, v, 'return_saleable', 1);
  assert.deepEqual(await stock(db, v), { physical: 5, reserved: 0, available: 5, inTransit: 0, damaged: 0 });
});

test('refused parcel comes back damaged: it is not sellable', async () => {
  const { db, v } = await stocked(5);
  await move(db, v, 'reserve', 1);
  await move(db, v, 'dispatch', 1);
  await move(db, v, 'return_damaged', 1);
  assert.deepEqual(await stock(db, v), { physical: 4, reserved: 0, available: 4, inTransit: 0, damaged: 1 });

  await move(db, v, 'writeoff', 1);
  assert.equal((await stock(db, v)).damaged, 0);
});

test('customer sends it back after delivery: it was not in transit any more', async () => {
  const { db, v } = await stocked(5);
  await move(db, v, 'reserve', 1);
  await move(db, v, 'dispatch', 1);
  await move(db, v, 'deliver', 1);
  await move(db, v, 'return_saleable', 1, { fromTransit: false });
  assert.deepEqual(await stock(db, v), { physical: 5, reserved: 0, available: 5, inTransit: 0, damaged: 0 });
});

test('damage found on the shelf moves stock out of sellable', async () => {
  const { db, v } = await stocked(5);
  await move(db, v, 'mark_damaged', 2);
  assert.deepEqual(await stock(db, v), { physical: 3, reserved: 0, available: 3, inTransit: 0, damaged: 2 });
});

test('impossible movements are rejected, not clamped', async () => {
  const { db, v } = await stocked(5);
  await assert.rejects(move(db, v, 'deliver', 1), /invalid_stock_movement/, 'nothing is in transit');
  await assert.rejects(move(db, v, 'release', 1), /invalid_stock_movement/, 'nothing is reserved');
  await assert.rejects(move(db, v, 'writeoff', 1), /invalid_stock_movement/, 'nothing is damaged');
  await assert.rejects(move(db, v, 'dispatch', 1), /invalid_stock_movement/, 'dispatch needs a reservation');
  await assert.rejects(move(db, v, 'stock_in', -1), /invalid_stock_movement/);
  await assert.rejects(move(db, v, 'stock_in', 0), /invalid_stock_movement/);
  assert.deepEqual(await stock(db, v), { physical: 5, reserved: 0, available: 5, inTransit: 0, damaged: 0 });
});

test('the ledger replays to exactly the current balances', async () => {
  const { db, v } = await stocked(20);
  await move(db, v, 'reserve', 5);
  await move(db, v, 'dispatch', 3);
  await move(db, v, 'release', 2);
  await move(db, v, 'deliver', 2);
  await move(db, v, 'return_damaged', 1);
  await move(db, v, 'mark_damaged', 2);
  await move(db, v, 'adjust', -1);
  await move(db, v, 'writeoff', 1);

  const replay = await one(db, `
    select sum(delta_physical)::int p, sum(delta_reserved)::int r,
           sum(delta_in_transit)::int t, sum(delta_damaged)::int d
      from stock_movements where variant_id = $1`, [v]);
  const s = await stock(db, v);
  assert.deepEqual(
    { physical: replay.p, reserved: replay.r, inTransit: replay.t, damaged: replay.d },
    { physical: s.physical, reserved: s.reserved, inTransit: s.inTransit, damaged: s.damaged },
  );
});

test('the ledger cannot be rewritten or deleted', async () => {
  const { db, v } = await stocked(5);
  await assert.rejects(db.query('update stock_movements set qty = 500 where variant_id = $1', [v]), /append-only/);
  await assert.rejects(db.query('delete from stock_movements where variant_id = $1', [v]), /append-only/);
});
