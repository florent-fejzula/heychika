import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, product, variant, move, stock, as } from './harness.js';

const arta = { first_name: 'Arta', last_name: 'K', phone: '044 123 456', city: 'Prishtina', address: 'Rr. Agim Ramadani 1' };

// Two dresses in stock: M (5 at €25, cost €10) and L (3 at €39, cost €15).
async function shop() {
  const db = await freshDb();
  const p = await product(db, { name: 'Wrap dress' });
  const m = await variant(db, p, { size: 'M', price: 25 });
  const l = await variant(db, p, { size: 'L', price: 39 });
  await move(db, m, 'stock_in', 5);
  await move(db, l, 'stock_in', 3);
  await db.query('update variants set cost_eur = 10 where id = $1', [m]);
  await db.query('update variants set cost_eur = 15 where id = $1', [l]);
  return { db, m, l };
}

// An order from the shop: 2 x M and 1 x L, to Kosovo (€2 delivery). Total €91.
async function online(db, m, l) {
  const r = await as(db, 'anon', (tx) => one(tx, 'select place_order($1, $2, $3) r',
    ['XK', JSON.stringify(arta), JSON.stringify([{ variant_id: m, qty: 2 }, { variant_id: l, qty: 1 }])]));
  return (await one(db, 'select id from orders where order_number = $1', [r.r.order_number])).id;
}

const staff = (db, sql, params) => as(db, 'staff', (tx) => one(tx, sql, params));
const order = (db, id) => one(db, 'select * from orders where id = $1', [id]);
const lines = async (db, id) => (await db.query('select * from order_lines where order_id = $1 order by variant_id', [id])).rows;
const history = async (db, id) =>
  (await db.query('select to_status, to_payment_status, note from order_status_history where order_id = $1 order by id', [id])).rows;

// ---------------------------------------------------------------------------
// The usual journey

test('confirm, send, deliver and get paid: the order completes and the stock follows each step', async () => {
  const { db, m, l } = await shop();
  const id = await online(db, m, l);
  assert.deepEqual(await stock(db, m), { physical: 5, reserved: 2, available: 3, inTransit: 0, damaged: 0 });

  await staff(db, 'select confirm_order($1)', [id]);
  assert.equal((await order(db, id)).status, 'confirmed');

  await staff(db, `select dispatch_order($1, 'Post Express', 'PE123')`, [id]);
  let o = await order(db, id);
  assert.equal(o.status, 'dispatched');
  assert.equal(o.courier_name, 'Post Express');
  assert.equal(o.tracking_ref, 'PE123');
  assert.deepEqual(await stock(db, m), { physical: 3, reserved: 0, available: 3, inTransit: 2, damaged: 0 });

  await staff(db, 'select mark_delivered($1, $2, $3)', [id, '[]', 91]);
  o = await order(db, id);
  assert.equal(o.status, 'completed');
  assert.equal(o.payment_status, 'paid');
  assert.equal(Number(o.amount_collected), 91);
  assert.equal(o.locked, true);
  assert.deepEqual(await stock(db, m), { physical: 3, reserved: 0, available: 3, inTransit: 0, damaged: 0 });

  assert.deepEqual((await history(db, id)).map((h) => [h.to_status, h.to_payment_status]), [
    ['new', 'unpaid'], ['confirmed', 'unpaid'], ['dispatched', 'unpaid'], ['delivered', 'unpaid'], ['completed', 'paid'],
  ]);
});

test('each item’s cost is frozen when it is sent, so restocking later can’t change this order’s profit', async () => {
  const { db, m, l } = await shop();
  const id = await online(db, m, l);
  await staff(db, 'select dispatch_order($1)', [id]);
  await db.query('update variants set cost_eur = 99 where id = $1', [m]);
  const [lm, ll] = await lines(db, id);
  assert.equal(Number(lm.unit_cost_eur), 10);
  assert.equal(Number(ll.unit_cost_eur), 15);
});

test('an order can be sent straight from new: sending it confirms it', async () => {
  const { db, m, l } = await shop();
  const id = await online(db, m, l);
  await staff(db, 'select dispatch_order($1)', [id]);
  const o = await order(db, id);
  assert.equal(o.status, 'dispatched');
  assert.ok(o.confirmed_at);
});

test('delivered now, cash later: it completes when the cash is recorded', async () => {
  const { db, m, l } = await shop();
  const id = await online(db, m, l);
  await staff(db, 'select dispatch_order($1)', [id]);
  await staff(db, 'select mark_delivered($1)', [id]);
  assert.deepEqual([(await order(db, id)).status, (await order(db, id)).payment_status], ['delivered', 'unpaid']);

  await staff(db, 'select record_payment($1, $2)', [id, 91]);
  assert.equal((await order(db, id)).status, 'completed');
  await assert.rejects(staff(db, 'select record_payment($1, $2)', [id, 91]), /invalid_status/);
});

test('steps out of order are refused, saying where the order is', async () => {
  const { db, m, l } = await shop();
  const id = await online(db, m, l);
  await assert.rejects(staff(db, 'select mark_delivered($1)', [id]), /invalid_status/);
  await assert.rejects(staff(db, 'select record_payment($1, 1)', [id]), /invalid_status/);
  await staff(db, 'select dispatch_order($1)', [id]);
  await assert.rejects(staff(db, 'select dispatch_order($1)', [id]), /invalid_status/, 'sending twice');
  await assert.rejects(staff(db, `select cancel_order($1, 'changed mind')`, [id]), /invalid_status/, 'too late to cancel');
  await assert.rejects(staff(db, 'select confirm_order($1)', [id]), /invalid_status/);
});

// ---------------------------------------------------------------------------
// Cancelling

test('cancelling puts the stock back on sale and keeps the reason', async () => {
  const { db, m, l } = await shop();
  const id = await online(db, m, l);
  await assert.rejects(staff(db, `select cancel_order($1, '  ')`, [id]), /invalid_order/, 'a reason is needed');
  await staff(db, `select cancel_order($1, 'customer changed her mind')`, [id]);

  const o = await order(db, id);
  assert.equal(o.status, 'cancelled');
  assert.equal(o.cancelled_reason, 'customer changed her mind');
  assert.equal((await stock(db, m)).available, 5);
  assert.equal((await stock(db, l)).available, 3);
  assert.equal((await history(db, id)).at(-1).note, 'customer changed her mind');
});

// ---------------------------------------------------------------------------
// Delivery problems and returns

test('a failed delivery moves nothing; the courier can try again', async () => {
  const { db, m, l } = await shop();
  const id = await online(db, m, l);
  await staff(db, 'select dispatch_order($1)', [id]);
  await staff(db, `select mark_delivery_failed($1, 'no answer')`, [id]);
  assert.equal((await order(db, id)).status, 'delivery_failed');
  assert.equal((await stock(db, m)).inTransit, 2, 'still on the road');
  assert.equal((await history(db, id)).at(-1).note, 'no answer');

  await staff(db, 'select retry_delivery($1)', [id]);
  assert.equal((await order(db, id)).status, 'dispatched');
});

test('a refused parcel comes back: saleable items return to the shelf, damaged ones are set aside', async () => {
  const { db, m, l } = await shop();
  const id = await online(db, m, l);
  await staff(db, 'select dispatch_order($1)', [id]);
  await staff(db, 'select mark_delivery_failed($1)', [id]);
  const [lm, ll] = await lines(db, id);

  const number = (await staff(db, `select record_return($1, $2, 'refused at the door') n`, [id, JSON.stringify([
    { order_line_id: lm.id, qty: 2, condition: 'saleable' },
    { order_line_id: ll.id, qty: 1, condition: 'damaged' },
  ])])).n;
  assert.match(number, /^RT-\d{4}-\d{4}$/);

  const o = await order(db, id);
  assert.equal(o.status, 'returned');
  assert.equal(o.payment_status, 'unpaid');
  assert.deepEqual(await stock(db, m), { physical: 5, reserved: 0, available: 5, inTransit: 0, damaged: 0 });
  assert.deepEqual(await stock(db, l), { physical: 2, reserved: 0, available: 2, inTransit: 0, damaged: 1 });
});

test('one item handed back at the door stays on the road until it is back, and the rest is paid', async () => {
  const { db, m, l } = await shop();
  const id = await online(db, m, l);
  await staff(db, 'select dispatch_order($1)', [id]);
  const [, ll] = await lines(db, id);

  // She keeps the two M dresses, refuses the L; the courier collects 50 + 2.
  await staff(db, 'select mark_delivered($1, $2, $3)', [id, JSON.stringify([{ order_line_id: ll.id, qty: 1 }]), 52]);
  let o = await order(db, id);
  assert.equal(o.status, 'completed');
  assert.equal(Number(o.amount_collected), 52);
  assert.equal((await stock(db, m)).inTransit, 0);
  assert.equal((await stock(db, l)).inTransit, 1, 'the refused one is on its way back');
  assert.equal((await lines(db, id))[1].refused_qty, 1);

  // It arrives back in Prishtina, fine to sell again.
  await staff(db, `select record_return($1, $2, 'refused at the door')`, [id, JSON.stringify([{ order_line_id: ll.id, qty: 1, condition: 'saleable' }])]);
  o = await order(db, id);
  assert.equal(o.status, 'partially_returned');
  assert.equal(o.payment_status, 'paid', 'nothing was refunded: she never paid for it');
  assert.deepEqual(await stock(db, l), { physical: 3, reserved: 0, available: 3, inTransit: 0, damaged: 0 });
  const after = (await lines(db, id))[1];
  assert.deepEqual([after.refused_qty, after.returned_qty], [0, 1]);
});

test('a customer sends something back after keeping it: back on the shelf and refunded in part', async () => {
  const { db, m, l } = await shop();
  const id = await online(db, m, l);
  await staff(db, 'select dispatch_order($1)', [id]);
  await staff(db, 'select mark_delivered($1, $2, $3)', [id, '[]', 91]);
  const [lm] = await lines(db, id);

  await staff(db, `select record_return($1, $2, 'too small', 25, 'cash')`, [id, JSON.stringify([{ order_line_id: lm.id, qty: 1, condition: 'saleable' }])]);
  const o = await order(db, id);
  assert.equal(o.status, 'partially_returned');
  assert.equal(o.payment_status, 'partially_refunded');
  assert.equal(o.locked, true, 'still frozen; returns are how it changes');
  assert.deepEqual(await stock(db, m), { physical: 4, reserved: 0, available: 4, inTransit: 0, damaged: 0 });

  const r = await one(db, 'select refund_amount_currency, refund_amount_eur, refund_method, user_id from returns');
  assert.equal(Number(r.refund_amount_currency), 25);
  assert.equal(r.refund_method, 'cash');
  assert.ok(r.user_id, 'who recorded it');

  // The rest comes back too, damaged; everything refunded.
  const [, ll] = await lines(db, id);
  await staff(db, `select record_return($1, $2, 'did not like them', 66)`, [id, JSON.stringify([
    { order_line_id: lm.id, qty: 1, condition: 'saleable' }, { order_line_id: ll.id, qty: 1, condition: 'damaged' }])]);
  const done = await order(db, id);
  assert.equal(done.status, 'returned');
  assert.equal(done.payment_status, 'refunded');
  assert.equal((await stock(db, l)).damaged, 1);
});

test('returns can’t take back more than was sent, refund more than was paid, or refund an unpaid order', async () => {
  const { db, m, l } = await shop();
  const id = await online(db, m, l);
  await staff(db, 'select dispatch_order($1)', [id]);
  const [lm] = await lines(db, id);
  const ret = (qty, refund = 0) => staff(db, `select record_return($1, $2, 'x', $3)`,
    [id, JSON.stringify([{ order_line_id: lm.id, qty, condition: 'saleable' }]), refund]);

  await assert.rejects(ret(3), /invalid_return/, 'only 2 were sent');
  await assert.rejects(ret(1, 10), /invalid_return/, 'not paid yet');

  await staff(db, 'select mark_delivered($1, $2, $3)', [id, '[]', 91]);
  await assert.rejects(ret(1, 100), /invalid_return/, 'more than was paid');
  await ret(2, 50);
  await assert.rejects(ret(1), /invalid_return/, 'both already back');

  const other = await online(db, m, l);
  const [otherLine] = await lines(db, other);
  await staff(db, 'select dispatch_order($1)', [other]);
  await assert.rejects(staff(db, `select record_return($1, $2, 'x')`,
    [id, JSON.stringify([{ order_line_id: otherLine.id, qty: 1, condition: 'saleable' }])]), /invalid_return/, 'a line from another order');
});

test('a new or cancelled order can’t have a return; cancel it instead', async () => {
  const { db, m, l } = await shop();
  const id = await online(db, m, l);
  const [lm] = await lines(db, id);
  await assert.rejects(staff(db, `select record_return($1, $2, 'x')`,
    [id, JSON.stringify([{ order_line_id: lm.id, qty: 1, condition: 'saleable' }])]), /invalid_status/);
});

test('a delivery where everything was refused is “not delivered”, not “delivered”', async () => {
  const { db, m, l } = await shop();
  const id = await online(db, m, l);
  await staff(db, 'select dispatch_order($1)', [id]);
  const [lm, ll] = await lines(db, id);
  await assert.rejects(staff(db, 'select mark_delivered($1, $2)', [id, JSON.stringify([
    { order_line_id: lm.id, qty: 2 }, { order_line_id: ll.id, qty: 1 }])]), (e) => e.detail === 'nothing_delivered');
  await assert.rejects(staff(db, 'select mark_delivered($1, $2)', [id, JSON.stringify([{ order_line_id: lm.id, qty: 3 }])]), /invalid_order/);
});

// ---------------------------------------------------------------------------
// Orders taken in a DM

test('an order typed in from a DM starts confirmed, holds the stock, and can use the agreed price', async () => {
  const { db, m, l } = await shop();
  const r = await staff(db, 'select create_manual_order($1, $2, $3, $4, $5) r', [
    'MK',
    JSON.stringify({ first_name: 'Besa', last_name: 'M', phone: '070 222 333', city: 'Tetovo', address: 'Ilindenska 5' }),
    JSON.stringify([{ variant_id: m, qty: 1, price: 1400 }, { variant_id: l, qty: 1 }]),
    null,
    'wants it before Friday',
  ]);
  const o = await order(db, r.r.id);
  assert.equal(o.channel, 'manual');
  assert.equal(o.status, 'confirmed');
  assert.equal(o.currency, 'MKD');
  assert.equal(o.delivery_notes, 'wants it before Friday');
  assert.equal(o.delivery_phone, '+38970222333');

  const [lm, ll] = await lines(db, o.id);
  assert.equal(Number(lm.unit_price_in_currency), 1400, 'the price agreed in the DM');
  assert.equal(Number(lm.unit_price_eur), 22.76, '1400 / 61.5');
  assert.equal(Number(lm.default_price_eur), 25, 'the usual price is kept alongside');
  assert.equal(Number(ll.unit_price_in_currency), 2400, 'today’s price: 39 x 61.5 = 2398.5 -> 2400');
  // 1400 + 2400 + 250 delivery (4 x 61.5 = 246 -> 250)
  assert.equal(Number(o.total_in_currency), 4050);
  assert.equal(Number(o.delivery_fee_in_currency), 250);
  assert.equal((await stock(db, m)).reserved, 1);
  assert.deepEqual((await history(db, o.id)).map((h) => h.to_status), ['confirmed']);
});

test('a DM order finds the customer by phone and brings her details up to date; free delivery can be given', async () => {
  const { db, m, l } = await shop();
  await online(db, m, l); // Arta, 044 123 456, Rr. Agim Ramadani 1
  const r = await staff(db, 'select create_manual_order($1, $2, $3, $4) r', [
    'XK',
    JSON.stringify({ ...arta, phone: '+383 44 123 456', address: 'New street 9' }),
    JSON.stringify([{ variant_id: m, qty: 1 }]),
    0,
  ]);
  assert.equal((await one(db, 'select count(*)::int n from customers')).n, 1);
  assert.equal((await one(db, 'select address from customers')).address, 'New street 9');
  const o = await order(db, r.r.id);
  assert.equal(Number(o.total_in_currency), 25, 'free delivery');
});

test('a DM order can be for a design not shown online, but not for a retired one, and only by staff', async () => {
  const { db } = await shop();
  const hidden = await variant(db, await product(db, { name: 'Not online', online: false }), { price: 20 });
  await move(db, hidden, 'stock_in', 1);
  const args = (v) => ['XK', JSON.stringify(arta), JSON.stringify([{ variant_id: v, qty: 1 }])];
  assert.ok((await staff(db, 'select create_manual_order($1, $2, $3) r', args(hidden))).r.order_number);

  const retired = await product(db, { name: 'Retired' });
  const rv = await variant(db, retired);
  await db.query(`update products set status = 'archived' where id = $1`, [retired]);
  await assert.rejects(staff(db, 'select create_manual_order($1, $2, $3) r', args(rv)), /not_available/);

  await assert.rejects(as(db, 'anon', (tx) => tx.query('select create_manual_order($1, $2, $3)', args(hidden))), /permission denied/);
  await assert.rejects(as(db, 'stranger', (tx) => tx.query('select create_manual_order($1, $2, $3)', args(hidden))), /not_authorized/);
});

// ---------------------------------------------------------------------------
// Changing an order before it is sent

test('changing the items swaps the stock held and keeps the prices already agreed', async () => {
  const { db, m, l } = await shop();
  const id = await online(db, m, l);
  await db.query('update variants set price_eur = 30 where id = $1', [m]); // price rises after she ordered

  // M down to 1, L removed, a new size S added.
  const p = (await one(db, 'select product_id from variants where id = $1', [m])).product_id;
  const s = await variant(db, p, { size: 'S', price: 20 });
  await move(db, s, 'stock_in', 2);
  await staff(db, 'select edit_order_items($1, $2)', [id, JSON.stringify([{ variant_id: m, qty: 1 }, { variant_id: s, qty: 1 }])]);

  const ls = await lines(db, id);
  assert.deepEqual(ls.map((x) => [Number(x.variant_id), x.qty, Number(x.unit_price_eur)]), [[m, 1, 25], [s, 1, 20]]);
  assert.equal((await stock(db, m)).reserved, 1);
  assert.equal((await stock(db, l)).reserved, 0);
  assert.equal((await stock(db, s)).reserved, 1);
  const o = await order(db, id);
  assert.equal(Number(o.total_in_currency), 25 + 20 + 2, 'the delivery fee is kept');
  assert.equal(Number(o.subtotal_eur), 45);
});

test('changing the items fails as a whole if a new item is out of stock', async () => {
  const { db, m, l } = await shop();
  const id = await online(db, m, l);
  await assert.rejects(staff(db, 'select edit_order_items($1, $2)', [id, JSON.stringify([{ variant_id: l, qty: 4 }])]), /insufficient_stock/);
  assert.equal((await lines(db, id)).length, 2, 'the order is as it was');
  assert.equal((await stock(db, m)).reserved, 2);
  await staff(db, 'select dispatch_order($1)', [id]);
  await assert.rejects(staff(db, 'select edit_order_items($1, $2)', [id, JSON.stringify([{ variant_id: m, qty: 1 }])]), /invalid_status/);
});

test('the address and phone can be corrected until it is delivered', async () => {
  const { db, m, l } = await shop();
  const id = await online(db, m, l);
  await staff(db, 'select update_order_details($1, $2)', [id, JSON.stringify({ delivery_address: 'Correct street 2', delivery_phone: '049 555 666', delivery_notes: 'fragile' })]);
  const o = await order(db, id);
  assert.equal(o.delivery_address, 'Correct street 2');
  assert.equal(o.delivery_phone, '+38349555666');
  assert.equal(o.delivery_notes, 'fragile');
  assert.equal(o.delivery_city, 'Prishtina', 'what wasn’t sent stays');
  await assert.rejects(staff(db, 'select update_order_details($1, $2)', [id, JSON.stringify({ delivery_phone: '12' })]), /invalid_order/);

  await staff(db, 'select dispatch_order($1)', [id]);
  await staff(db, 'select mark_delivered($1)', [id]);
  await assert.rejects(staff(db, 'select update_order_details($1, $2)', [id, JSON.stringify({ delivery_city: 'X' })]), /invalid_status/);
});

// ---------------------------------------------------------------------------
// Access

test('none of the order steps are open to the public or to strangers', async () => {
  const { db, m, l } = await shop();
  const id = await online(db, m, l);
  for (const sql of ['select confirm_order($1)', `select cancel_order($1, 'x')`, 'select dispatch_order($1)', 'select mark_delivered($1)',
    'select record_payment($1, 1)', 'select mark_delivery_failed($1)', 'select retry_delivery($1)', `select update_order_details($1, '{}')`,
    `select edit_order_items($1, '[]')`, `select record_return($1, '[]', 'x')`]) {
    await assert.rejects(as(db, 'anon', (tx) => tx.query(sql, [id])), /permission denied/, sql);
    await assert.rejects(as(db, 'stranger', (tx) => tx.query(sql, [id])), /not_authorized/, sql);
  }
  for (const fn of ['private.lock_order($1, \'{new}\')', 'private.take_payment($1, 1)']) {
    await assert.rejects(as(db, 'staff', (tx) => tx.query(`select ${fn}`, [id])), /permission denied/, fn);
  }
  assert.equal((await order(db, id)).status, 'new');
});
