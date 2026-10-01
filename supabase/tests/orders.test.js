// Order *flows* (checkout, dispatch, COD collection) arrive in later phases.
// These tests cover what the schema itself guarantees already.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, id, product, variant } from './harness.js';

async function orderWithOneLine() {
  const db = await freshDb();
  const p = await product(db, { name: 'Black satin wrap dress' });
  const v = await variant(db, p, { color: 'BLK', size: 'M', price: 39 });
  const customer = await id(db, `
    insert into customers (first_name, last_name, phone, country, city, address)
    values ('Arta', 'K', '+383 44 123 456', 'XK', 'Prishtina', 'Rr. Agim Ramadani 1') returning id`);
  const order = await one(db, `
    insert into orders (customer_id, channel, country, currency, currency_per_eur)
    values ($1, 'online', 'XK', 'EUR', 1) returning id, order_number`, [customer]);
  await db.query('insert into order_lines (order_id, variant_id, qty) values ($1, $2, 1)', [order.id, v]);
  return { db, p, v, order };
}

test('orders get a readable number', async () => {
  const { order } = await orderWithOneLine();
  assert.match(order.order_number, /^HC-\d{4}-0001$/);
});

test('order lines keep a snapshot of what was bought', async () => {
  const { db, p, v, order } = await orderWithOneLine();
  await db.query(`update products set name = 'Renamed later' where id = $1`, [p]);
  await db.query('update variants set price_eur = 99 where id = $1', [v]);

  const l = await one(db, 'select * from order_lines where order_id = $1', [order.id]);
  assert.equal(l.product_name_snapshot, 'Black satin wrap dress');
  assert.equal(l.color_snapshot, 'Black');
  assert.equal(l.size_snapshot, 'M');
  assert.equal(l.sku_snapshot, 'DR-001-BLK-M');
  assert.equal(Number(l.default_price_eur), 39);
  assert.equal(Number(l.unit_price_eur), 39);
  assert.equal(Number(l.line_total_eur), 39);
});

test('a discounted price is kept alongside the default price', async () => {
  const { db, v, order } = await orderWithOneLine();
  const p2 = await variant(db, await product(db), { size: 'L', price: 50 });
  const l = await one(db, `insert into order_lines (order_id, variant_id, qty, unit_price_eur)
                           values ($1, $2, 2, 45) returning default_price_eur, unit_price_eur, line_total_eur`, [order.id, p2]);
  assert.equal(Number(l.default_price_eur), 50);
  assert.equal(Number(l.unit_price_eur), 45);
  assert.equal(Number(l.line_total_eur), 90);
});

test('every status and payment change is recorded automatically', async () => {
  const { db, order } = await orderWithOneLine();
  await db.query(`update orders set status = 'confirmed' where id = $1`, [order.id]);
  await db.query(`update orders set status = 'dispatched' where id = $1`, [order.id]);
  await db.query(`update orders set delivery_notes = 'ring twice' where id = $1`, [order.id]);

  const { rows } = await db.query(
    'select from_status, to_status from order_status_history where order_id = $1 order by id', [order.id]);
  assert.deepEqual(rows, [
    { from_status: null, to_status: 'new' },
    { from_status: 'new', to_status: 'confirmed' },
    { from_status: 'confirmed', to_status: 'dispatched' },
  ], 'non-status edits do not add history rows');
});

test('an order cannot be completed until delivered and paid', async () => {
  const { db, order } = await orderWithOneLine();
  await assert.rejects(db.query(`update orders set status = 'completed' where id = $1`, [order.id]), /check constraint/);
  await assert.rejects(
    db.query(`update orders set status = 'completed', delivered_at = now() where id = $1`, [order.id]),
    /check constraint/, 'delivered but unpaid is not complete');
});

test('a completed order is frozen; corrections go through a return', async () => {
  const { db, order } = await orderWithOneLine();
  await db.query(`
    update orders set status = 'completed', payment_status = 'paid', delivered_at = now(), paid_at = now(),
                      total_eur = 39, total_in_currency = 39
     where id = $1`, [order.id]);

  const o = await one(db, 'select locked, completed_at from orders where id = $1', [order.id]);
  assert.equal(o.locked, true);
  assert.ok(o.completed_at);

  await assert.rejects(db.query('update orders set total_eur = 10 where id = $1', [order.id]), /order_locked/);
  await assert.rejects(db.query('update orders set locked = false where id = $1', [order.id]), /order_locked/);
  await assert.rejects(db.query('update order_lines set unit_price_eur = 1 where order_id = $1', [order.id]), /order_locked/);
  await assert.rejects(db.query('delete from order_lines where order_id = $1', [order.id]), /order_locked/);

  // What a return is allowed to touch
  await db.query(`update order_lines set returned_qty = 1 where order_id = $1`, [order.id]);
  await db.query(`update orders set status = 'returned', payment_status = 'refunded' where id = $1`, [order.id]);
});

test('customers can be found by phone however it was typed', async () => {
  const { db } = await orderWithOneLine();
  const c = await one(db, `select first_name from customers where phone_digits = regexp_replace($1, '\\D', '', 'g')`, ['+383-44-123-456']);
  assert.equal(c.first_name, 'Arta');
});

test('an order in EUR cannot carry a non-1 exchange rate', async () => {
  const { db } = await orderWithOneLine();
  const c = (await one(db, 'select id from customers')).id;
  await assert.rejects(
    db.query(`insert into orders (customer_id, channel, country, currency, currency_per_eur) values ($1, 'online', 'XK', 'EUR', 61.5)`, [c]),
    /check constraint/);
});
