import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, id, product, variant, move, as } from './harness.js';

const slugOf = async (db, pid) => (await one(db, 'select slug from products where id = $1', [pid])).slug;

// ---------------------------------------------------------------------------
// Slugs

test('a new design gets a readable, unique link without being given one', async () => {
  const db = await freshDb();
  const a = await id(db, `insert into products (category_id, name) values ((select id from categories where code = 'DR'), 'Black Satin Wrap Dress!') returning id`);
  const b = await id(db, `insert into products (category_id, name) values ((select id from categories where code = 'DR'), 'Black Satin Wrap Dress!') returning id`);
  assert.equal(await slugOf(db, a), 'black-satin-wrap-dress-dr-001');
  assert.equal(await slugOf(db, b), 'black-satin-wrap-dress-dr-002', 'same name, still unique');
});

test('a name with no latin letters still gets a valid link', async () => {
  const db = await freshDb();
  const p = await id(db, `insert into products (category_id, name) values ((select id from categories where code = 'DR'), 'Фустан') returning id`);
  assert.equal(await slugOf(db, p), 'design-dr-001');
});

test('a very long name is cut so links stay short', async () => {
  const db = await freshDb();
  const p = await id(db, `insert into products (category_id, name) values ((select id from categories where code = 'DR'), $1) returning id`, ['a'.repeat(200)]);
  assert.ok((await slugOf(db, p)).length <= 70);
});

test('renaming a design does not break the link people already shared', async () => {
  const db = await freshDb();
  const p = await product(db, { name: 'Wrap dress' });
  const before = await slugOf(db, p);
  await db.query(`update products set name = 'Completely different name' where id = $1`, [p]);
  assert.equal(await slugOf(db, p), before);
});

// ---------------------------------------------------------------------------
// Variants: creating and deleting

test('staff can remove a variant that was never used, and its empty stock row goes too', async () => {
  const db = await freshDb();
  const v = await variant(db, await product(db));
  await as(db, 'staff', (tx) => tx.query('delete from variants where id = $1', [v]));
  assert.equal((await one(db, 'select count(*)::int n from variants where id = $1', [v])).n, 0);
  assert.equal((await one(db, 'select count(*)::int n from stock where variant_id = $1', [v])).n, 0);
});

test('a variant with history cannot be deleted', async () => {
  const db = await freshDb();
  const v = await variant(db, await product(db));
  await move(db, v, 'stock_in', 3);
  await assert.rejects(as(db, 'staff', (tx) => tx.query('delete from variants where id = $1', [v])), /variant_locked/);
  assert.equal((await one(db, 'select qty_physical from stock where variant_id = $1', [v])).qty_physical, 3);
});

test('staff create variants with identity and price, but cannot set cost or the lock', async () => {
  const db = await freshDb();
  const p = await product(db);
  const colour = `(select id from colors where code = 'RED')`;
  const size = `(select id from sizes where code = 'S')`;

  await as(db, 'staff', (tx) => tx.query(
    `insert into variants (product_id, color_id, size_id, price_eur) values ($1, ${colour}, ${size}, 39)`, [p]));

  await assert.rejects(as(db, 'staff', (tx) => tx.query(
    `insert into variants (product_id, color_id, size_id, cost_eur) values ($1, ${colour}, (select id from sizes where code = 'M'), 1)`, [p])),
    /permission denied/);
  await assert.rejects(as(db, 'staff', (tx) => tx.query(
    `insert into variants (product_id, color_id, size_id, locked) values ($1, ${colour}, (select id from sizes where code = 'L'), true)`, [p])),
    /permission denied/);
});

test('staff can add several variants in one go, each getting its own SKU', async () => {
  const db = await freshDb();
  const p = await product(db);
  await as(db, 'staff', (tx) => tx.query(`
    insert into variants (product_id, color_id, size_id, price_eur)
    select $1, c.id, s.id, 29 from colors c, sizes s where c.code in ('BLK', 'RED') and s.code in ('S', 'M', 'L')`, [p]));
  const { rows } = await db.query('select sku from variants where product_id = $1 order by sku', [p]);
  assert.deepEqual(rows.map((r) => r.sku), [
    'DR-001-BLK-L', 'DR-001-BLK-M', 'DR-001-BLK-S', 'DR-001-RED-L', 'DR-001-RED-M', 'DR-001-RED-S']);
});

// ---------------------------------------------------------------------------
// Codes that live inside SKUs

test('a category code is frozen once it has designs, but its name is free to change', async () => {
  const db = await freshDb();
  await product(db, { category: 'DR' });
  await assert.rejects(db.query(`update categories set code = 'FR' where code = 'DR'`), /code_in_use/);
  await db.query(`update categories set name = 'Gowns' where code = 'DR'`);
  await db.query(`update categories set code = 'ZZ' where code = 'JK'`); // no designs: free
});

test('a colour and size code are frozen once variants use them', async () => {
  const db = await freshDb();
  await variant(db, await product(db), { color: 'BLK', size: 'M' });
  await assert.rejects(db.query(`update colors set code = 'XXX' where code = 'BLK'`), /code_in_use/);
  await assert.rejects(db.query(`update sizes set code = 'MED' where code = 'M'`), /code_in_use/);
  await db.query(`update colors set name = 'Jet black' where code = 'BLK'`);
  await db.query(`update colors set code = 'XXX' where code = 'PNK'`);
});

// ---------------------------------------------------------------------------
// Photos

async function photo(db, productId, order = 0) {
  return id(db, `insert into product_images (product_id, storage_path, sort_order) values ($1, $2, $3) returning id`,
    [productId, `${productId}/${Math.random().toString(36).slice(2)}.jpg`, order]);
}
const primaries = async (db, pid) =>
  (await db.query('select id from product_images where product_id = $1 and is_primary order by id', [pid])).rows.map((r) => r.id);

test('the first photo becomes the cover automatically; later ones do not', async () => {
  const db = await freshDb();
  const p = await product(db);
  const first = await photo(db, p, 1);
  await photo(db, p, 2);
  await photo(db, p, 3);
  assert.deepEqual(await primaries(db, p), [first]);
});

test('staff can choose a different cover; there is only ever one', async () => {
  const db = await freshDb();
  const p = await product(db);
  await photo(db, p, 1);
  const second = await photo(db, p, 2);
  await as(db, 'staff', (tx) => tx.query('select set_primary_image($1)', [second]));
  assert.deepEqual(await primaries(db, p), [second]);
});

test('deleting the cover promotes the next photo in order', async () => {
  const db = await freshDb();
  const p = await product(db);
  const first = await photo(db, p, 1);
  await photo(db, p, 3);
  const next = await photo(db, p, 2);
  await db.query('delete from product_images where id = $1', [first]);
  assert.deepEqual(await primaries(db, p), [next]);
});

test('deleting the only photo leaves the design with none, without error', async () => {
  const db = await freshDb();
  const p = await product(db);
  await db.query('delete from product_images where id = $1', [await photo(db, p)]);
  assert.deepEqual(await primaries(db, p), []);
});

test('photos can be reordered, and a design cannot reorder another design\'s photos', async () => {
  const db = await freshDb();
  const p = await product(db);
  const other = await product(db, { name: 'Other dress' });
  const a = await photo(db, p, 1);
  const b = await photo(db, p, 2);
  const c = await photo(db, p, 3);
  const foreign = await photo(db, other, 7);

  await as(db, 'staff', (tx) => tx.query('select reorder_images($1, $2)', [p, [c, a, b, foreign]]));

  const { rows } = await db.query('select id from product_images where product_id = $1 order by sort_order', [p]);
  assert.deepEqual(rows.map((r) => r.id), [c, a, b]);
  assert.equal((await one(db, 'select sort_order from product_images where id = $1', [foreign])).sort_order, 7);
});

test('the public cannot change covers or order, and strangers are refused', async () => {
  const db = await freshDb();
  const p = await product(db);
  const img = await photo(db, p);
  await assert.rejects(as(db, 'anon', (tx) => tx.query('select set_primary_image($1)', [img])), /permission denied/);
  await assert.rejects(as(db, 'stranger', (tx) => tx.query('select set_primary_image($1)', [img])), /not_authorized/);
  await assert.rejects(as(db, 'stranger', (tx) => tx.query('select reorder_images($1, $2)', [p, [img]])), /not_authorized/);
});

test('the shop can see photos only for designs that are online', async () => {
  const db = await freshDb();
  const live = await product(db, { name: 'Live', online: true });
  const hidden = await product(db, { name: 'Hidden', online: false });
  await photo(db, live);
  await photo(db, hidden);
  const { rows } = await as(db, 'anon', (tx) => tx.query('select product_id from product_images'));
  assert.deepEqual(rows.map((r) => Number(r.product_id)), [Number(live)]);
});
