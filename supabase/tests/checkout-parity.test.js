// The shop shows the customer a total (web/src/app/core/money.ts, bagTotals) and sends it
// with the order. The database works the total out again and refuses the order if the two
// differ. So if they ever drifted apart, every order in some currency would be refused.
// This feeds the same random bags, rates and delivery fees to both and requires them to agree.
//
// Needs Node's TypeScript stripping, which `npm test` turns on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bagTotals } from '../../web/src/app/core/money.ts';
import { freshDb, one, product, variant, move, as } from './harness.js';

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COUNTRIES = [['XK', 'EUR'], ['MK', 'MKD'], ['AL', 'ALL']];

test('the total the shop shows is the total the database charges, across 60 random bags', async () => {
  const db = await freshDb();
  const rand = rng(20261004);
  const pick = (list) => list[Math.floor(rand() * list.length)];

  const p = await product(db);
  const variants = [];
  for (const size of ['XS', 'S', 'M', 'L', 'XL', 'XXL']) {
    const v = await variant(db, p, { size });
    await move(db, v, 'stock_in', 1000);
    variants.push(v);
  }

  for (let trial = 0; trial < 60; trial++) {
    const fx = {
      mkd_per_eur: pick([61.5, 61.6953, 61.4]),
      all_per_eur: pick([98, 97.35, 101.2]),
      mkd_rounding: pick([50, 10, 1]),
      all_rounding: pick([100, 50, 10]),
    };
    await db.query(
      'update settings set mkd_per_eur = $1, all_per_eur = $2, mkd_rounding = $3, all_rounding = $4',
      [fx.mkd_per_eur, fx.all_per_eur, fx.mkd_rounding, fx.all_rounding]);

    const [country, currency] = pick(COUNTRIES);
    const zone = {
      country,
      currency,
      fee_eur: pick([0, 2, 3.5, 4, 4.99]),
      free_over_eur: pick([null, null, 50, 75.5]),
      est_days: null,
    };
    await db.query('update delivery_zones set fee_eur = $2, free_over_eur = $3 where country = $1',
      [country, zone.fee_eur, zone.free_over_eur]);

    // Prices like real ones: whole euros, .50s and .99s.
    const lines = [];
    const chosen = variants.filter(() => rand() < 0.5);
    for (const v of chosen.length ? chosen : [variants[0]]) {
      const price = Math.floor(8 + rand() * 60) + pick([0, 0.5, 0.99]);
      await db.query('update variants set price_eur = $2 where id = $1', [v, price]);
      lines.push({ variant_id: v, qty: 1 + Math.floor(rand() * 5), priceEur: price });
    }

    const shown = bagTotals(lines.map((l) => ({ priceEur: l.priceEur, qty: l.qty })), zone, fx);
    const customer = { first_name: 'T', last_name: String(trial), phone: `+38344${String(100000 + trial)}`, city: 'X', address: 'Street 1' };

    const r = await as(db, 'anon', (tx) => one(tx, 'select place_order($1, $2, $3, null, $4) r',
      [country, JSON.stringify(customer), JSON.stringify(lines.map(({ variant_id, qty }) => ({ variant_id, qty }))), shown.total]))
      .then((x) => x.r)
      .catch((e) => assert.fail(`trial ${trial} (${currency}): shop showed ${shown.total}, database says ${e.detail} [${e.message}]`));

    assert.equal(Number(r.total_in_currency), shown.total, `trial ${trial}`);
    const o = await one(db, 'select subtotal_eur, delivery_fee_in_currency from orders where order_number = $1', [r.order_number]);
    assert.equal(Number(o.subtotal_eur), shown.subtotalEur, `trial ${trial}: subtotal`);
    assert.equal(Number(o.delivery_fee_in_currency), shown.delivery, `trial ${trial}: delivery`);
  }
});
