import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, product, variant, move, stock, as } from './harness.js';

// A shop with two dresses in stock: three at €25, one at €39.
async function shop() {
  const db = await freshDb();
  const p = await product(db, { name: 'Wrap dress' });
  const m = await variant(db, p, { size: 'M', price: 25 });
  const l = await variant(db, p, { size: 'L', price: 39 });
  await move(db, m, 'stock_in', 3);
  await move(db, l, 'stock_in', 1);
  return { db, p, m, l };
}

const arta = { first_name: 'Arta', last_name: 'Krasniqi', phone: '044 123 456', city: 'Prishtina', address: 'Rr. Agim Ramadani 1' };

function order(db, lines, { country = 'XK', customer = arta, notes = null, expected = null, who = 'anon' } = {}) {
  return as(db, who, (tx) =>
    one(tx, 'select place_order($1, $2, $3, $4, $5) r', [country, JSON.stringify(customer), JSON.stringify(lines), notes, expected]),
  ).then((row) => row.r);
}

const orderRow = (db, number) => one(db, 'select * from orders where order_number = $1', [number]);

// ---------------------------------------------------------------------------
// The happy path

test('a customer places an order from the shop, and the stock is held for them', async () => {
  const { db, m, l } = await shop();
  const r = await order(db, [{ variant_id: m, qty: 2 }, { variant_id: l, qty: 1 }], { notes: 'call before' });

  assert.match(r.order_number, /^HC-\d{4}-\d{4}$/);
  assert.equal(r.currency, 'EUR');
  assert.equal(Number(r.total_in_currency), 25 * 2 + 39 + 2, 'items plus the €2 Kosovo delivery');

  const o = await orderRow(db, r.order_number);
  assert.equal(o.status, 'new');
  assert.equal(o.payment_status, 'unpaid');
  assert.equal(o.channel, 'online');
  assert.equal(Number(o.subtotal_eur), 89);
  assert.equal(Number(o.delivery_fee_eur), 2);
  assert.equal(Number(o.total_eur), 91);
  assert.equal(o.delivery_name, 'Arta Krasniqi');
  assert.equal(o.delivery_phone, '+38344123456');
  assert.equal(o.delivery_address, 'Rr. Agim Ramadani 1');
  assert.equal(o.customer_notes, 'call before');

  assert.deepEqual(await stock(db, m), { physical: 3, reserved: 2, available: 1, inTransit: 0, damaged: 0 });
  assert.deepEqual(await stock(db, l), { physical: 1, reserved: 1, available: 0, inTransit: 0, damaged: 0 });

  const moves = await db.query(`select type, qty, ref_type, ref_id from stock_movements where type = 'reserve' order by variant_id`);
  assert.deepEqual(moves.rows.map((x) => [x.type, x.qty, x.ref_type, Number(x.ref_id)]), [
    ['reserve', 2, 'order', Number(o.id)],
    ['reserve', 1, 'order', Number(o.id)],
  ]);
});

test('a Macedonian order is priced in denars, item by item as the shop shows them', async () => {
  const { db, m } = await shop();
  const r = await order(db, [{ variant_id: m, qty: 2 }], { country: 'MK', customer: { ...arta, phone: '070 123 456' } });
  // €25 -> 1537.50 -> 1550 MKD each; €4 delivery -> 246 -> 250 MKD.
  assert.equal(r.currency, 'MKD');
  assert.equal(Number(r.total_in_currency), 1550 * 2 + 250);

  const o = await orderRow(db, r.order_number);
  assert.equal(Number(o.currency_per_eur), 61.5, 'the rate is frozen on the order');
  assert.equal(Number(o.delivery_fee_in_currency), 250);
  assert.equal(o.delivery_phone, '+38970123456');
  const line = await one(db, 'select unit_price_in_currency from order_lines where order_id = $1', [o.id]);
  assert.equal(Number(line.unit_price_in_currency), 1550);
});

test('an Albanian order is priced in lek', async () => {
  const { db, l } = await shop();
  const r = await order(db, [{ variant_id: l, qty: 1 }], { country: 'AL', customer: { ...arta, phone: '069 123 4567' } });
  // €39 -> 3822 -> 3900 ALL; €4 -> 392 -> 400 ALL.
  assert.equal(Number(r.total_in_currency), 3900 + 400);
});

test('delivery is free over the threshold when one is set', async () => {
  const { db, m, l } = await shop();
  await db.query(`update delivery_zones set free_over_eur = 60 where country = 'XK'`);
  const small = await order(db, [{ variant_id: m, qty: 1 }]);
  assert.equal(Number(small.total_in_currency), 27);
  const big = await order(db, [{ variant_id: m, qty: 1 }, { variant_id: l, qty: 1 }]);
  assert.equal(Number(big.total_in_currency), 64, '25 + 39, no delivery fee');
});

test('the same item sent twice counts once, with the quantities added', async () => {
  const { db, m } = await shop();
  const r = await order(db, [{ variant_id: m, qty: 1 }, { variant_id: m, qty: 1 }]);
  const o = await orderRow(db, r.order_number);
  const { rows } = await db.query('select qty from order_lines where order_id = $1', [o.id]);
  assert.deepEqual(rows.map((x) => x.qty), [2]);
});

test('a repeat customer is recognised by phone, however they type it, and their details are not overwritten', async () => {
  const { db, m } = await shop();
  await order(db, [{ variant_id: m, qty: 1 }]);
  const r2 = await order(db, [{ variant_id: m, qty: 1 }], {
    customer: { ...arta, phone: '+383 44 123 456', address: 'Somewhere else 5' },
  });
  assert.equal((await one(db, 'select count(*)::int n from customers')).n, 1);
  assert.equal((await one(db, 'select address from customers')).address, 'Rr. Agim Ramadani 1');
  assert.equal((await orderRow(db, r2.order_number)).delivery_address, 'Somewhere else 5', 'this parcel goes to the new address');
});

test('a logged-in owner can place an order through the shop too', async () => {
  const { db, m } = await shop();
  const r = await order(db, [{ variant_id: m, qty: 1 }], { who: 'staff' });
  assert.ok(r.order_number);
});

// ---------------------------------------------------------------------------
// Stock

test('the last one goes to whoever orders first; the second is told how many are left', async () => {
  const { db, l } = await shop();
  await order(db, [{ variant_id: l, qty: 1 }]);
  const err = await order(db, [{ variant_id: l, qty: 1 }], { customer: { ...arta, phone: '044 999 888' } }).catch((e) => e);
  assert.match(err.message, /insufficient_stock/);
  assert.equal(err.detail, String(l));
  assert.equal(err.hint, '0');
});

test('a failed order leaves nothing behind: no order, no customer, no stock held', async () => {
  const { db, m, l } = await shop();
  await assert.rejects(order(db, [{ variant_id: m, qty: 1 }, { variant_id: l, qty: 2 }]), /insufficient_stock/);
  assert.equal((await one(db, 'select count(*)::int n from orders')).n, 0);
  assert.equal((await one(db, 'select count(*)::int n from customers')).n, 0);
  assert.equal((await stock(db, m)).reserved, 0);
});

test('asking for more than is left says how many are', async () => {
  const { db, m } = await shop();
  const err = await order(db, [{ variant_id: m, qty: 4 }]).catch((e) => e);
  assert.match(err.message, /insufficient_stock/);
  assert.equal(err.hint, '3');
});

test('only what the shop shows can be bought', async () => {
  const { db, m, p } = await shop();
  const hidden = await variant(db, await product(db, { name: 'Draft', online: false }), { price: 1 });
  await move(db, hidden, 'stock_in', 5);
  const err = await order(db, [{ variant_id: hidden, qty: 1 }]).catch((e) => e);
  assert.match(err.message, /not_available/);
  assert.equal(err.detail, String(hidden));

  await db.query('update variants set active = false where id = $1', [m]);
  await assert.rejects(order(db, [{ variant_id: m, qty: 1 }]), /not_available/);

  await db.query('update variants set active = true where id = $1', [m]);
  await db.query(`update products set status = 'archived' where id = $1`, [p]);
  await assert.rejects(order(db, [{ variant_id: m, qty: 1 }]), /not_available/);

  await assert.rejects(order(db, [{ variant_id: 999999, qty: 1 }]), /not_available/);
});

// ---------------------------------------------------------------------------
// Money comes from the database, never from the request

test('the request cannot set its own price', async () => {
  const { db, m } = await shop();
  const r = await order(db, [{ variant_id: m, qty: 1, unit_price_eur: 0.01, price: 0.01 }]);
  assert.equal(Number(r.total_in_currency), 27);
});

test('if prices changed while the bag was open, the order stops and says the new total', async () => {
  const { db, m } = await shop();
  await db.query('update variants set price_eur = 30 where id = $1', [m]);
  const err = await order(db, [{ variant_id: m, qty: 1 }], { expected: 27 }).catch((e) => e);
  assert.match(err.message, /price_changed/);
  assert.equal(Number(err.detail), 32);
  assert.equal((await one(db, 'select count(*)::int n from orders')).n, 0);

  const ok = await order(db, [{ variant_id: m, qty: 1 }], { expected: 32 });
  assert.equal(Number(ok.total_in_currency), 32);
});

// ---------------------------------------------------------------------------
// Checking what the customer typed

test('a customer must give a name, a phone that can be called, a city and an address', async () => {
  const { db, m } = await shop();
  const line = [{ variant_id: m, qty: 1 }];
  const cases = [
    [{ ...arta, first_name: '  ' }, 'first_name'],
    [{ ...arta, phone: '12345' }, 'phone'],
    [{ ...arta, phone: 'call me' }, 'phone'],
    [{ ...arta, city: '' }, 'city'],
    [{ ...arta, address: '' }, 'address'],
    [{ ...arta, address: 'x'.repeat(201) }, 'address'],
  ];
  for (const [customer, field] of cases) {
    const err = await order(db, line, { customer }).catch((e) => e);
    assert.match(err.message, /invalid_order/, field);
    assert.equal(err.detail, field);
  }
});

test('phone numbers are stored one way, whatever way they are typed', async () => {
  const db = await freshDb();
  const norm = async (phone, country) => (await one(db, 'select private.normalize_phone($1, $2) p', [phone, country])).p;
  assert.equal(await norm('044 123 456', 'XK'), '+38344123456');
  assert.equal(await norm('+383 44 123 456', 'XK'), '+38344123456');
  assert.equal(await norm('00383 44 123 456', 'XK'), '+38344123456');
  assert.equal(await norm('38344123456', 'XK'), '+38344123456');
  assert.equal(await norm('070/123-456', 'MK'), '+38970123456');
  assert.equal(await norm('069 123 4567', 'AL'), '+355691234567');
  assert.equal(await norm('+41 79 123 45 67', 'XK'), '+41791234567', 'a Swiss number stays Swiss');
  assert.equal(await norm('+383 44 123 456', 'MK'), '+38344123456', 'a Kosovo number delivered to Macedonia stays a Kosovo number');
  assert.equal(await norm('123', 'XK'), null);
});

test('an empty bag, silly quantities and junk are refused', async () => {
  const { db, m } = await shop();
  const detail = (lines) => order(db, lines).catch((e) => e.detail);
  assert.equal(await detail([]), 'empty');
  assert.equal(await detail([{ variant_id: m, qty: 0 }]), 'qty');
  assert.equal(await detail([{ variant_id: m, qty: -1 }]), 'qty');
  assert.equal(await detail([{ variant_id: m, qty: 6 }]), 'qty');
  assert.equal(await detail([{ variant_id: m }]), 'qty');
  assert.equal(await detail([{ variant_id: 'abc', qty: 1 }]), 'lines');
  assert.equal(await detail([{ variant_id: m, qty: 1.5 }]), 'lines');
  const many = Array.from({ length: 21 }, (_, i) => ({ variant_id: i + 1, qty: 1 }));
  assert.equal(await detail(many), 'too_many_items');
  assert.equal(await order(db, [{ variant_id: m, qty: 1 }], { country: 'DE' }).catch((e) => /invalid input value for enum/.test(e.message)), true);
});

test('a country the shop has switched off cannot be ordered to', async () => {
  const { db, m } = await shop();
  await db.query(`update delivery_zones set active = false where country = 'AL'`);
  const err = await order(db, [{ variant_id: m, qty: 1 }], { country: 'AL' }).catch((e) => e);
  assert.equal(err.detail, 'country');
});

test('one phone can only have a few unconfirmed orders at a time, so the stock cannot be tied up', async () => {
  const { db, m } = await shop();
  await move(db, m, 'stock_in', 10);
  for (let i = 0; i < 3; i++) await order(db, [{ variant_id: m, qty: 1 }]);
  await assert.rejects(order(db, [{ variant_id: m, qty: 1 }]), /too_many_orders/);
  await assert.rejects(order(db, [{ variant_id: m, qty: 1 }], { customer: { ...arta, phone: '+38344123456' } }), /too_many_orders/);

  // Once the shop confirms one, they can order again.
  await db.query(`update orders set status = 'confirmed' where id = (select min(id) from orders)`);
  assert.ok((await order(db, [{ variant_id: m, qty: 1 }])).order_number);
});

// ---------------------------------------------------------------------------
// Access

test('the shop still cannot touch orders, customers or stock except through checkout', async () => {
  const { db, m } = await shop();
  await assert.rejects(as(db, 'anon', (tx) => tx.query(
    `insert into orders (customer_id, channel, country, currency, currency_per_eur) values (1, 'online', 'XK', 'EUR', 1)`)), /permission denied/);
  await assert.rejects(as(db, 'anon', (tx) => tx.query(
    `insert into customers (first_name, phone, country, city, address) values ('x', '044123456', 'XK', 'x', 'xxx')`)), /permission denied/);
  await assert.rejects(as(db, 'anon', (tx) => tx.query('select private.normalize_phone($1, $2)', ['044123456', 'XK'])), /permission denied/);
  await order(db, [{ variant_id: m, qty: 1 }]);
  await assert.rejects(as(db, 'anon', (tx) => tx.query('select * from orders')), /permission denied/);
});

test('a logged-in stranger cannot use the staff side, but can still check out like anyone', async () => {
  const { db, m } = await shop();
  const r = await order(db, [{ variant_id: m, qty: 1 }], { who: 'stranger' });
  assert.ok(r.order_number);
  const { rows } = await as(db, 'stranger', (tx) => tx.query('select * from orders'));
  assert.equal(rows.length, 0);
});

// ---------------------------------------------------------------------------
// Tracking

test('a customer can look up their order with its number and their phone', async () => {
  const { db, m } = await shop();
  const r = await order(db, [{ variant_id: m, qty: 2 }]);
  const track = (number, phone) => as(db, 'anon', (tx) => one(tx, 'select track_order($1, $2) t', [number, phone])).then((x) => x.t);

  const t = await track(r.order_number, '+383 44 123 456');
  assert.equal(t.order_number, r.order_number);
  assert.equal(t.status, 'new');
  assert.equal(t.first_name, 'Arta');
  assert.equal(t.city, 'Prishtina');
  assert.equal(Number(t.total), 52);
  assert.deepEqual(t.lines.map((x) => [x.name, x.color, x.size, x.qty, Number(x.price)]), [['Wrap dress', 'Black', 'M', 2, 25]]);
  assert.equal(t.address, undefined, 'the street address is not given out');
  assert.equal(t.delivery_phone, undefined);

  assert.ok(await track(r.order_number.toLowerCase(), '044123456'), 'forgiving about case and the leading 0');
  assert.equal(await track(r.order_number, '044 999 999'), null, 'wrong phone');
  assert.equal(await track(r.order_number, ''), null, 'no phone');
  assert.equal(await track('HC-2026-9999', '044 123 456'), null, 'wrong number');
});
