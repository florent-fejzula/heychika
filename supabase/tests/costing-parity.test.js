// The admin shows a cost preview before a purchase is received (web/src/app/core/costing.ts).
// The database stores the real figures when it is received. If the two ever drift apart,
// the owners would see one cost and the books would hold another. So this feeds the same
// random trips to both and requires them to agree.
//
// Needs Node's TypeScript stripping, which `npm test` turns on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landedCosts, weightedAverage } from '../../web/src/app/core/costing.ts';
import { freshDb, id, product, variant, purchase, receive, one } from './harness.js';

// Small seeded generator so a failure can be reproduced.
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CURRENCIES = [
  ['EUR', 1],
  ['USD', 1.0842],
  ['TRY', 38.5],
];
const TOLERANCE = 1.1e-4; // both sides round to 4 decimals; allow one step at a boundary

test('the cost preview matches what the database stores, across 60 random trips', async () => {
  const db = await freshDb();
  const rand = rng(20261002);
  const pick = (n) => Math.floor(rand() * n);
  const money = (max) => Math.round((0.5 + rand() * max) * 100) / 100;

  const p = await product(db);
  const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const variants = [];
  for (const size of sizes) variants.push(await variant(db, p, { size }));
  const state = new Map(variants.map((v) => [v, { cost: 0, onHand: 0 }])); // what the books should say

  for (let trip = 0; trip < 60; trip++) {
    const [currency, rate] = CURRENCIES[pick(CURRENCIES.length)];
    const method = rand() < 0.5 ? 'by_quantity' : 'by_value';
    const extra = rand() < 0.2 ? 0 : money(500);
    const chosen = variants.slice(0, 1 + pick(variants.length));
    const lines = chosen.map((v) => ({ v, qty: 1 + pick(50), price: money(120) }));

    const expected = landedCosts(
      lines.map((l) => ({ qty: l.qty, unitPrice: l.price })),
      { currencyPerEur: rate, extraCostsEur: extra, method },
    );

    const pid = await purchase(db, lines.map((l) => [l.v, l.qty, l.price]), { currency, rate, extra, method });
    await receive(db, pid);

    const { rows } = await db.query(
      'select variant_id, unit_price_eur, allocated_extra_eur, unit_landed_cost_eur from purchase_lines where purchase_id = $1 order by id',
      [pid],
    );
    const where = `trip ${trip} (${currency} @ ${rate}, ${method}, extra ${extra})`;

    lines.forEach((l, i) => {
      const got = rows[i];
      const want = expected.lines[i];
      assert.ok(Math.abs(Number(got.unit_price_eur) - want.unitPriceEur) <= TOLERANCE, `${where}: price in EUR`);
      assert.ok(Math.abs(Number(got.allocated_extra_eur) - want.extraEur) <= TOLERANCE, `${where}: share of trip costs`);
      assert.ok(Math.abs(Number(got.unit_landed_cost_eur) - want.landedEur) <= TOLERANCE, `${where}: landed cost`);

      // The running average carries across trips, so a drift would compound.
      const s = state.get(l.v);
      s.cost = weightedAverage(s.cost, s.onHand, want.landedEur, l.qty);
      s.onHand += l.qty;
    });
  }

  for (const [v, s] of state) {
    const row = await one(db, 'select v.cost_eur, st.qty_physical from variants v join stock st on st.variant_id = v.id where v.id = $1', [v]);
    assert.equal(row.qty_physical, s.onHand, 'quantity on hand');
    assert.ok(Math.abs(Number(row.cost_eur) - s.cost) <= 3e-4, `average cost for variant ${v}: database ${row.cost_eur}, preview ${s.cost}`);
  }
});

test('trip costs are fully accounted for: what lands on the items adds back up to the trip', async () => {
  const db = await freshDb();
  const p = await product(db);
  const a = await variant(db, p, { size: 'S' });
  const b = await variant(db, p, { size: 'M' });
  const c = await variant(db, p, { size: 'L' });
  for (const method of ['by_quantity', 'by_value']) {
    const pid = await purchase(db, [[a, 7, 13.3], [b, 3, 8.1], [c, 11, 21]], { extra: 123.45, method });
    await receive(db, pid);
    const { rows } = await db.query(
      'select sum(qty * allocated_extra_eur) as spread from purchase_lines where purchase_id = $1',
      [pid],
    );
    // Each share is rounded to 4 decimals, so allow a fraction of a cent over 21 items.
    assert.ok(Math.abs(Number(rows[0].spread) - 123.45) < 0.01, `${method}: ${rows[0].spread}`);
  }
  assert.ok(await id(db, 'select 1 id'));
});
