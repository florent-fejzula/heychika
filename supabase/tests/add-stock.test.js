import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, id, product, variant, move, as } from './harness.js';

const staff = (db, sql, params) => as(db, 'staff', (tx) => one(tx, sql, params));
const ref = async (db) => ({
  dresses: await id(db, `select id from categories where code = 'DR'`),
  black: await id(db, `select id from colors where code = 'BLK'`),
  white: await id(db, `select id from colors where code = 'WHT'`),
  s: await id(db, `select id from sizes where code = 'S'`),
  m: await id(db, `select id from sizes where code = 'M'`),
  l: await id(db, `select id from sizes where code = 'L'`),
});

const save = (db, purchaseId, item, who = 'staff') =>
  as(db, who, (tx) => one(tx, 'select save_trip_item($1, $2) r', [purchaseId, JSON.stringify(item)])).then((row) => row.r);

const stockOf = async (db, productId) =>
  (await db.query(`
    select c.code colour, s.code size, st.qty_physical n, v.cost_eur::float cost, v.price_eur::float price
      from variants v join colors c on c.id = v.color_id join sizes s on s.id = v.size_id join stock st on st.variant_id = v.id
     where v.product_id = $1 order by c.code, s.sort_order`, [productId])).rows;

async function draftTrip(db, { currency = 'EUR', rate = 1, extra = 0 } = {}) {
  return staff(db, `insert into purchases (reference, currency, currency_per_eur, extra_costs_eur) values ('Istanbul, October', $1, $2, $3) returning id`,
    [currency, rate, extra]).then((r) => r.id);
}

// ---------------------------------------------------------------------------
// Straight into stock

test('a new design goes straight onto the shelf: design, sizes, price, stock and cost in one step', async () => {
  const db = await freshDb();
  const r = await ref(db);
  const out = await save(db, null, {
    category_id: r.dresses, name: 'Satin wrap dress', price_eur: 39, unit_price: 14,
    lines: [{ color_id: r.black, size_id: r.s, qty: 2 }, { color_id: r.black, size_id: r.m, qty: 3 }],
  });

  const p = await one(db, 'select name, status, show_online, slug from products where id = $1', [out.product_id]);
  assert.equal(p.status, 'active');
  assert.equal(p.show_online, true);
  assert.deepEqual(await stockOf(db, out.product_id), [
    { colour: 'BLK', size: 'S', n: 2, cost: 14, price: 39 },
    { colour: 'BLK', size: 'M', n: 3, cost: 14, price: 39 },
  ]);
  const trip = await one(db, 'select reference, status from purchases where id = $1', [out.purchase_id]);
  assert.match(trip.reference, /^Added by hand, /);
  assert.equal(trip.status, 'received');

  // The shop can see it straight away.
  const seen = await as(db, 'anon', (tx) => tx.query('select id from products where id = $1', [out.product_id]));
  assert.equal(seen.rows.length, 1);
});

test('it can be kept out of the online shop', async () => {
  const db = await freshDb();
  const r = await ref(db);
  const out = await save(db, null, {
    category_id: r.dresses, name: 'DM only dress', show_online: false, price_eur: 30, unit_price: 10,
    lines: [{ color_id: r.black, size_id: r.m, qty: 1 }],
  });
  assert.equal((await one(db, 'select show_online from products where id = $1', [out.product_id])).show_online, false);
});

test('the rest of a new design goes in the same step: description, material, brand, featured', async () => {
  const db = await freshDb();
  const r = await ref(db);
  const out = await save(db, null, {
    category_id: r.dresses, name: 'Linen dress', description: '  Loose fit, falls below the knee.  ', material: 'Linen',
    brand: 'Vavex', featured: true, price_eur: 35, unit_price: 12,
    lines: [{ color_id: r.black, size_id: r.m, qty: 1 }],
  });
  assert.deepEqual(
    { ...(await one(db, 'select description, material, brand, featured from products where id = $1', [out.product_id])) },
    { description: 'Loose fit, falls below the knee.', material: 'Linen', brand: 'Vavex', featured: true },
  );

  // Left empty, they stay empty.
  const bare = await save(db, null, {
    category_id: r.dresses, name: 'Plain dress', description: ' ', brand: '', price_eur: 30, unit_price: 10,
    lines: [{ color_id: r.black, size_id: r.m, qty: 1 }],
  });
  assert.deepEqual(
    { ...(await one(db, 'select description, material, brand, featured from products where id = $1', [bare.product_id])) },
    { description: null, material: null, brand: null, featured: false },
  );
});

test('a trip can say about how many items it brought', async () => {
  const db = await freshDb();
  const trip = await staff(db, `insert into purchases (reference, extra_costs_eur, expected_items) values ('Istanbul, October', 300, 140) returning id, expected_items`);
  assert.equal(trip.expected_items, 140);
  await staff(db, 'update purchases set expected_items = 150 where id = $1 returning id', [trip.id]);
  assert.equal((await one(db, 'select expected_items from purchases where id = $1', [trip.id])).expected_items, 150);
  await assert.rejects(staff(db, 'update purchases set expected_items = 0 where id = $1 returning id', [trip.id]), /check/);
});

test('more of a design already in stock: same sizes reused, new ones added, the average cost moves', async () => {
  const db = await freshDb();
  const r = await ref(db);
  const first = await save(db, null, {
    category_id: r.dresses, name: 'Wrap dress', price_eur: 39, unit_price: 10,
    lines: [{ color_id: r.black, size_id: r.m, qty: 2 }],
  });
  await save(db, null, {
    product_id: first.product_id, price_eur: 42, unit_price: 16,
    lines: [{ color_id: r.black, size_id: r.m, qty: 2 }, { color_id: r.white, size_id: r.l, qty: 1 }],
  });

  assert.deepEqual(await stockOf(db, first.product_id), [
    { colour: 'BLK', size: 'M', n: 4, cost: 13, price: 42 },
    { colour: 'WHT', size: 'L', n: 1, cost: 16, price: 42 },
  ]);
  assert.equal((await one(db, 'select count(*)::int n from products')).n, 1, 'no duplicate design');
});

// ---------------------------------------------------------------------------
// On a buying trip

test('on a trip, items wait for Receive, and trip costs land on them then', async () => {
  const db = await freshDb();
  const r = await ref(db);
  const trip = await draftTrip(db, { currency: 'TRY', rate: 40, extra: 20 });
  const out = await save(db, trip, {
    category_id: r.dresses, name: 'Linen dress', price_eur: 45, unit_price: 600,
    lines: [{ color_id: r.black, size_id: r.s, qty: 5 }, { color_id: r.black, size_id: r.m, qty: 5 }],
  });
  assert.equal(out.purchase_id, trip);
  assert.equal((await stockOf(db, out.product_id)).reduce((n, x) => n + x.n, 0), 0, 'nothing on the shelf yet');

  await staff(db, 'select receive_purchase($1) r', [trip]);
  // 600 TRY / 40 = €15, plus €20 of trip costs over 10 items = €17 each.
  assert.deepEqual((await stockOf(db, out.product_id)).map((x) => [x.n, x.cost]), [[5, 17], [5, 17]]);
});

test('saving the same design again corrects the trip: new numbers replace the old, a size set to 0 comes off', async () => {
  const db = await freshDb();
  const r = await ref(db);
  const trip = await draftTrip(db);
  const out = await save(db, trip, {
    category_id: r.dresses, name: 'Wrap dress', price_eur: 39, unit_price: 12,
    lines: [{ color_id: r.black, size_id: r.s, qty: 2 }, { color_id: r.black, size_id: r.m, qty: 3 }],
  });
  await save(db, trip, {
    product_id: out.product_id, price_eur: 39, unit_price: 11,
    lines: [{ color_id: r.black, size_id: r.s, qty: 0 }, { color_id: r.black, size_id: r.m, qty: 4 }],
  });

  const lines = (await db.query(`
    select s.code size, l.qty, l.unit_price::float price from purchase_lines l
      join variants v on v.id = l.variant_id join sizes s on s.id = v.size_id where l.purchase_id = $1`, [trip])).rows;
  assert.deepEqual(lines, [{ size: 'M', qty: 4, price: 11 }]);
});

test('other designs on the trip are left alone', async () => {
  const db = await freshDb();
  const r = await ref(db);
  const trip = await draftTrip(db);
  await save(db, trip, { category_id: r.dresses, name: 'Dress one', price_eur: 30, unit_price: 10, lines: [{ color_id: r.black, size_id: r.m, qty: 1 }] });
  const two = await save(db, trip, { category_id: r.dresses, name: 'Dress two', price_eur: 30, unit_price: 10, lines: [{ color_id: r.black, size_id: r.m, qty: 1 }] });
  await save(db, trip, { product_id: two.product_id, price_eur: 30, unit_price: 10, lines: [{ color_id: r.black, size_id: r.m, qty: 2 }] });
  assert.equal((await one(db, 'select sum(qty)::int n from purchase_lines where purchase_id = $1', [trip])).n, 3);
});

test('a received trip cannot take more items', async () => {
  const db = await freshDb();
  const r = await ref(db);
  const trip = await draftTrip(db);
  await save(db, trip, { category_id: r.dresses, name: 'Dress', price_eur: 30, unit_price: 10, lines: [{ color_id: r.black, size_id: r.m, qty: 1 }] });
  await staff(db, 'select receive_purchase($1) r', [trip]);
  await assert.rejects(
    save(db, trip, { category_id: r.dresses, name: 'Late dress', price_eur: 30, unit_price: 10, lines: [{ color_id: r.black, size_id: r.m, qty: 1 }] }),
    /purchase_received/,
  );
  assert.equal((await one(db, `select count(*)::int n from products where name = 'Late dress'`)).n, 0);
});

// ---------------------------------------------------------------------------
// Mistakes and access

test('missing details are refused, field by field, and nothing is half-made', async () => {
  const db = await freshDb();
  const r = await ref(db);
  const good = { category_id: r.dresses, name: 'Dress', price_eur: 30, unit_price: 10, lines: [{ color_id: r.black, size_id: r.m, qty: 1 }] };
  const field = (detail) => (e) => e.message === 'invalid_item' && e.detail === detail;

  await assert.rejects(save(db, null, { ...good, name: ' ' }), field('name'));
  await assert.rejects(save(db, null, { ...good, category_id: null }), field('category'));
  await assert.rejects(save(db, null, { ...good, price_eur: -1 }), field('price'));
  await assert.rejects(save(db, null, { ...good, price_eur: 'abc' }), field('price'));
  await assert.rejects(save(db, null, { ...good, unit_price: null }), field('unit_price'));
  await assert.rejects(save(db, null, { ...good, lines: [] }), field('lines'));
  await assert.rejects(save(db, null, { ...good, lines: [{ color_id: r.black, size_id: r.m, qty: 0 }] }), field('lines'));
  await assert.rejects(save(db, null, { ...good, lines: [{ color_id: r.black, size_id: r.m, qty: -2 }] }), field('lines'));

  for (const t of ['products', 'variants', 'purchases', 'purchase_lines']) {
    assert.equal((await one(db, `select count(*)::int n from ${t}`)).n, 0, t);
  }
});

test('only staff can add stock', async () => {
  const db = await freshDb();
  const r = await ref(db);
  const item = { category_id: r.dresses, name: 'Dress', price_eur: 30, unit_price: 10, lines: [{ color_id: r.black, size_id: r.m, qty: 1 }] };
  await assert.rejects(save(db, null, item, 'anon'), /permission denied/);
  await assert.rejects(save(db, null, item, 'stranger'), /not_authorized/);
});

// ---------------------------------------------------------------------------
// The barcode on the tag

const link = (db, variantId, code, who = 'staff') =>
  as(db, who, (tx) => tx.query('select link_barcode($1, $2)', [variantId, code]));

test('a size takes the barcode from its tag, even with stock history, and the change is kept', async () => {
  const db = await freshDb();
  const p = await product(db);
  const v = await variant(db, p);
  await move(db, v, 'stock_in', 3); // locks the size's codes
  const { sku } = await one(db, 'select sku from variants where id = $1', [v]);

  await link(db, v, ' 8691234567890 ');
  const after = await one(db, 'select sku, barcode from variants where id = $1', [v]);
  assert.equal(after.barcode, '8691234567890');
  assert.equal(after.sku, sku, 'the SKU never changes');

  const change = await one(db, 'select old_barcode, new_barcode, reason from variant_code_changes where variant_id = $1', [v]);
  assert.deepEqual(change, { old_barcode: sku, new_barcode: '8691234567890', reason: 'Linked the barcode on its tag' });

  // Unlinking puts the SKU back.
  await link(db, v, null);
  assert.equal((await one(db, 'select barcode from variants where id = $1', [v])).barcode, sku);
});

test('one barcode, one size: a code already on another size is refused and says which', async () => {
  const db = await freshDb();
  const p = await product(db);
  const a = await variant(db, p, { size: 'S' });
  const b = await variant(db, p, { size: 'M' });
  await link(db, a, '8691234567890');
  const skuA = (await one(db, 'select sku from variants where id = $1', [a])).sku;

  await assert.rejects(link(db, b, '8691234567890'), (e) => e.message === 'barcode_in_use' && e.detail === skuA);
  await assert.rejects(link(db, b, skuA), (e) => e.message === 'barcode_in_use' && e.detail === skuA, 'nor another size’s SKU');
  await assert.rejects(link(db, b, ''), /invalid_barcode/);
  await assert.rejects(link(db, b, 'two words'), /invalid_barcode/);
});

test('only staff can link barcodes', async () => {
  const db = await freshDb();
  const v = await variant(db, await product(db));
  await assert.rejects(link(db, v, '123456', 'anon'), /permission denied/);
  await assert.rejects(link(db, v, '123456', 'stranger'), /not_authorized/);
});
