import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, id, product, variant, purchase, receive, as } from './harness.js';

async function twoSizes() {
  const db = await freshDb();
  const p = await product(db);
  return { db, a: await variant(db, p, { size: 'S' }), b: await variant(db, p, { size: 'M' }) };
}

// ---------------------------------------------------------------------------
// What the buying-trip screens do, as staff

test('staff can start a trip and add items by saving the same size twice (the grid replaces, not duplicates)', async () => {
  const { db, a } = await twoSizes();
  const pid = await as(db, 'staff', async (tx) => {
    const trip = await id(tx, `insert into purchases (reference, currency, currency_per_eur, extra_costs_eur, allocation_method)
                               values ('Istanbul', 'TRY', 38.5, 120, 'by_quantity') returning id`);
    await tx.query(
      `insert into purchase_lines (purchase_id, variant_id, qty, unit_price) values ($1, $2, 3, 450)
       on conflict (purchase_id, variant_id) do update set purchase_id = excluded.purchase_id, variant_id = excluded.variant_id, qty = excluded.qty, unit_price = excluded.unit_price`,
      [trip, a]);
    await tx.query(
      `insert into purchase_lines (purchase_id, variant_id, qty, unit_price) values ($1, $2, 8, 500)
       on conflict (purchase_id, variant_id) do update set purchase_id = excluded.purchase_id, variant_id = excluded.variant_id, qty = excluded.qty, unit_price = excluded.unit_price`,
      [trip, a]);
    return trip;
  });
  const { rows } = await db.query('select qty, unit_price from purchase_lines where purchase_id = $1', [pid]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qty, 8);
  assert.equal(Number(rows[0].unit_price), 500);
});

test('staff can remove some items from a draft trip', async () => {
  const { db, a, b } = await twoSizes();
  const pid = await purchase(db, [[a, 1, 5], [b, 2, 5]]);
  await as(db, 'staff', (tx) => tx.query('delete from purchase_lines where purchase_id = $1 and variant_id = any($2)', [pid, [a]]));
  const { rows } = await db.query('select variant_id from purchase_lines where purchase_id = $1', [pid]);
  assert.deepEqual(rows.map((r) => Number(r.variant_id)), [Number(b)]);
});

test('staff can delete a draft trip, and its items go with it', async () => {
  const { db, a } = await twoSizes();
  const pid = await purchase(db, [[a, 1, 5]]);
  await as(db, 'staff', (tx) => tx.query('delete from purchases where id = $1', [pid]));
  assert.equal((await one(db, 'select count(*)::int n from purchase_lines where purchase_id = $1', [pid])).n, 0);
});

test('a euro trip must use exactly 1 per euro', async () => {
  const { db } = await twoSizes();
  await assert.rejects(
    as(db, 'staff', (tx) => tx.query(`insert into purchases (reference, currency, currency_per_eur) values ('x', 'EUR', 1.08)`)),
    /check constraint/);
});

// ---------------------------------------------------------------------------
// Receiving is the only way a trip becomes real

test('staff cannot mark a trip received by hand, which would skip the stock and the costing', async () => {
  const { db, a } = await twoSizes();
  const pid = await purchase(db, [[a, 5, 10]]);
  await assert.rejects(
    as(db, 'staff', (tx) => tx.query(`update purchases set status = 'received', received_at = now() where id = $1`, [pid])),
    /permission denied/);
  await assert.rejects(
    as(db, 'staff', (tx) => tx.query(`insert into purchases (reference, status, received_at) values ('sneaky', 'received', now())`)),
    /permission denied/);
  assert.equal((await one(db, 'select qty_physical from stock where variant_id = $1', [a])).qty_physical, 0);
});

test('staff cannot write the stored costs by hand either', async () => {
  const { db, a } = await twoSizes();
  const pid = await purchase(db, [[a, 5, 10]]);
  await assert.rejects(
    as(db, 'staff', (tx) => tx.query('update purchase_lines set unit_landed_cost_eur = 0.01 where purchase_id = $1', [pid])),
    /permission denied/);
  await assert.rejects(
    as(db, 'staff', (tx) => tx.query(
      'insert into purchase_lines (purchase_id, variant_id, qty, unit_price, unit_landed_cost_eur) values ($1, $2, 1, 1, 0.01)', [pid, a])),
    /permission denied/);
});

test('a received trip cannot be changed, however the change is attempted', async () => {
  const { db, a, b } = await twoSizes();
  const done = await purchase(db, [[a, 5, 10]]);
  await receive(db, done);
  const draft = await purchase(db, [[b, 1, 1]]);

  const staff = (sql, params) => as(db, 'staff', (tx) => tx.query(sql, params));
  await assert.rejects(staff('update purchase_lines set qty = 99 where purchase_id = $1', [done]), /purchase_received/);
  await assert.rejects(staff('delete from purchase_lines where purchase_id = $1', [done]), /purchase_received/);
  await assert.rejects(staff('insert into purchase_lines (purchase_id, variant_id, qty, unit_price) values ($1, $2, 1, 1)', [done, b]), /purchase_received/);
  await assert.rejects(staff('update purchases set extra_costs_eur = 77 where id = $1', [done]), /purchase_received/);
  await assert.rejects(staff('delete from purchases where id = $1', [done]), /purchase_received/);

  // Moving a line out of a received trip into a draft would rewrite history just as well.
  await assert.rejects(
    staff('update purchase_lines set purchase_id = $1 where purchase_id = $2', [draft, done]),
    /purchase_received/);
  // ... and so would moving one in.
  await assert.rejects(
    staff('update purchase_lines set purchase_id = $1 where purchase_id = $2', [done, draft]),
    /purchase_received/);

  const { rows } = await db.query('select qty from purchase_lines where purchase_id = $1', [done]);
  assert.deepEqual(rows.map((r) => r.qty), [5]);
});

// ---------------------------------------------------------------------------
// The stock screens

test('staff can read the stock ledger and who made each change', async () => {
  const { db, a } = await twoSizes();
  await receive(db, await purchase(db, [[a, 5, 10]]));
  await as(db, 'staff', (tx) => tx.query(`select record_stock_change($1, 'adjust', -1, 'stock check')`, [a]));
  const { rows } = await as(db, 'staff', (tx) => tx.query('select type, user_id from stock_movements where variant_id = $1 order by id', [a]));
  assert.deepEqual(rows.map((r) => r.type), ['stock_in', 'adjust']);
  assert.ok(rows[1].user_id, 'a manual change records who made it');
  const people = await as(db, 'staff', (tx) => tx.query('select id, name from profiles'));
  assert.equal(people.rows.length, 1);
});

test('the public shop can read none of the ledger or the buying trips', async () => {
  const { db } = await twoSizes();
  for (const t of ['stock_movements', 'purchases', 'purchase_lines']) {
    await assert.rejects(as(db, 'anon', (tx) => tx.query(`select 1 from ${t}`)), /permission denied/, t);
  }
});
