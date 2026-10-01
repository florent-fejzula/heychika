import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, product, variant, move, as, STAFF_ID } from './harness.js';

test('each new design gets the next number in its category', async () => {
  const db = await freshDb();
  const a = await product(db, { category: 'DR', name: 'Wrap dress' });
  const b = await product(db, { category: 'DR', name: 'Slip dress' });
  const c = await product(db, { category: 'PN', name: 'Wide-leg pants' });

  const codes = async (pid) => (await one(db, 'select model_code from products where id = $1', [pid])).model_code;
  assert.equal(await codes(a), '001');
  assert.equal(await codes(b), '002');
  assert.equal(await codes(c), '001', 'numbering is per category');
});

test('a variant gets its SKU and barcode generated, and an empty stock row', async () => {
  const db = await freshDb();
  const p = await product(db, { category: 'DR' });
  const v = await variant(db, p, { color: 'BLK', size: 'M' });

  const row = await one(db, 'select sku, barcode, locked from variants where id = $1', [v]);
  assert.equal(row.sku, 'DR-001-BLK-M');
  assert.equal(row.barcode, 'DR-001-BLK-M', 'barcode is Code128 encoding the SKU');
  assert.equal(row.locked, false);

  const s = await one(db, 'select qty_physical, qty_available from stock where variant_id = $1', [v]);
  assert.deepEqual(s, { qty_physical: 0, qty_available: 0 });
});

test('two different black dresses in M are two separate SKUs', async () => {
  const db = await freshDb();
  const wrap = await variant(db, await product(db, { name: 'Wrap dress' }));
  const slip = await variant(db, await product(db, { name: 'Slip dress' }));

  const sku = async (v) => (await one(db, 'select sku from variants where id = $1', [v])).sku;
  assert.equal(await sku(wrap), 'DR-001-BLK-M');
  assert.equal(await sku(slip), 'DR-002-BLK-M');
});

test('the same colour and size cannot be added twice to one design', async () => {
  const db = await freshDb();
  const p = await product(db);
  await variant(db, p, { color: 'BLK', size: 'M' });
  await assert.rejects(variant(db, p, { color: 'BLK', size: 'M' }), /duplicate key/);
});

test('duplicate barcodes are rejected', async () => {
  const db = await freshDb();
  const a = await variant(db, await product(db), { size: 'S' });
  const b = await variant(db, await product(db), { size: 'M' });
  const taken = (await one(db, 'select barcode from variants where id = $1', [a])).barcode;
  await assert.rejects(db.query('update variants set barcode = $1 where id = $2', [taken, b]), /duplicate key/);
});

test('an unused SKU can still be fixed freely', async () => {
  const db = await freshDb();
  const v = await variant(db, await product(db));
  await db.query(`update variants set sku = 'DR-001-BLK-L', barcode = 'DR-001-BLK-L' where id = $1`, [v]);
});

test('first stock movement locks the SKU and barcode against editing', async () => {
  const db = await freshDb();
  const v = await variant(db, await product(db));
  await move(db, v, 'stock_in', 5);

  assert.equal((await one(db, 'select locked from variants where id = $1', [v])).locked, true);
  await assert.rejects(db.query(`update variants set sku = 'X' where id = $1`, [v]), /variant_locked/);
  await assert.rejects(db.query(`update variants set barcode = 'X' where id = $1`, [v]), /variant_locked/);
  await assert.rejects(
    db.query(`update variants set size_id = (select id from sizes where code = 'L') where id = $1`, [v]),
    /variant_locked/,
  );
  await assert.rejects(db.query('update variants set locked = false where id = $1', [v]), /variant_locked/);

  // Price changes are still allowed
  await db.query('update variants set price_eur = 39 where id = $1', [v]);
});

test('a product with locked variants cannot change category', async () => {
  const db = await freshDb();
  const p = await product(db, { category: 'DR' });
  await move(db, await variant(db, p), 'stock_in', 1);
  await assert.rejects(
    db.query(`update products set category_id = (select id from categories where code = 'SK') where id = $1`, [p]),
    /product_locked/,
  );
  await db.query(`update products set name = 'Renamed is fine' where id = $1`, [p]);
});

test('a locked SKU can be corrected deliberately, and the old value is kept', async () => {
  const db = await freshDb();
  const v = await variant(db, await product(db));
  await move(db, v, 'stock_in', 1);

  await as(db, 'staff', (tx) =>
    tx.query(`select correct_variant_codes($1, 'DR-001-BLK-L', 'DR-001-BLK-L', 'tag printed with wrong size')`, [v]),
  );

  const row = await one(db, 'select sku, locked from variants where id = $1', [v]);
  assert.equal(row.sku, 'DR-001-BLK-L');
  assert.equal(row.locked, true);

  const log = await one(db, 'select old_sku, new_sku, reason, user_id from variant_code_changes where variant_id = $1', [v]);
  assert.equal(log.old_sku, 'DR-001-BLK-M');
  assert.equal(log.reason, 'tag printed with wrong size');
  assert.equal(log.user_id, STAFF_ID);

  // The bypass doesn't leak into later statements
  await assert.rejects(db.query(`update variants set sku = 'Y' where id = $1`, [v]), /variant_locked/);
});
