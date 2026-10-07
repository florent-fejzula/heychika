import { estimateLanded, landedCosts, weightedAverage } from './costing';

const eur = { currencyPerEur: 1, extraCostsEur: 0, method: 'by_quantity' as const };

// These are the same scenarios as supabase/tests/costing.test.js. If they ever
// disagree, the preview would show one number and the database store another.
describe('landedCosts', () => {
  it('costs the goods only when there are no trip costs', () => {
    const r = landedCosts([{ qty: 10, unitPrice: 20 }], eur);
    expect(r.lines[0]).toEqual({ unitPriceEur: 20, extraEur: 0, landedEur: 20 });
    expect(r.problem).toBeNull();
  });

  it('spreads the trip evenly per item: 80 items, €400 trip -> €5 each', () => {
    const r = landedCosts([{ qty: 50, unitPrice: 10 }, { qty: 30, unitPrice: 30 }], { ...eur, extraCostsEur: 400 });
    expect(r.lines.map((l) => l.extraEur)).toEqual([5, 5]);
    expect(r.lines.map((l) => l.landedEur)).toEqual([15, 35]);
    expect(r.totalQty).toBe(80);
  });

  it('can spread by price so dearer items carry more', () => {
    const r = landedCosts([{ qty: 10, unitPrice: 20 }, { qty: 10, unitPrice: 40 }], { ...eur, extraCostsEur: 60, method: 'by_value' });
    expect(r.lines.map((l) => l.landedEur)).toEqual([22, 44]);
  });

  it('converts a foreign currency at the trip rate', () => {
    const r = landedCosts([{ qty: 10, unitPrice: 900 }], { currencyPerEur: 45, extraCostsEur: 30, method: 'by_quantity' });
    expect(r.lines[0]).toEqual({ unitPriceEur: 20, extraEur: 3, landedEur: 23 });
    expect(r.goodsEur).toBe(200);
  });

  it('every euro of trip cost lands on some item', () => {
    const lines = [{ qty: 7, unitPrice: 13.3 }, { qty: 3, unitPrice: 8.1 }, { qty: 11, unitPrice: 21 }];
    for (const method of ['by_quantity', 'by_value'] as const) {
      const r = landedCosts(lines, { currencyPerEur: 1, extraCostsEur: 123.45, method });
      const spread = r.lines.reduce((sum, l, i) => sum + l.extraEur * lines[i].qty, 0);
      expect(spread).toBeCloseTo(123.45, 1);
    }
  });

  it('flags an empty purchase', () => {
    expect(landedCosts([], eur).problem).toBe('no_items');
    expect(landedCosts([{ qty: 0, unitPrice: 5 }], eur).problem).toBe('no_items');
  });

  it('flags trip costs that cannot be spread by price when everything is free', () => {
    const r = landedCosts([{ qty: 5, unitPrice: 0 }], { ...eur, extraCostsEur: 10, method: 'by_value' });
    expect(r.problem).toBe('zero_value');
    expect(r.lines[0].extraEur).toBe(0);
  });

  it('is fine with free goods when spreading by quantity', () => {
    const r = landedCosts([{ qty: 5, unitPrice: 0 }], { ...eur, extraCostsEur: 10 });
    expect(r.problem).toBeNull();
    expect(r.lines[0].landedEur).toBe(2);
  });
});

describe('weightedAverage', () => {
  it('blends old and new stock by quantity: 10 at €20 + 10 at €24 -> €22', () => {
    expect(weightedAverage(20, 10, 24, 10)).toBe(22);
  });

  it('only counts what is still on the shelf: 2 left at €20 + 8 at €30 -> €28', () => {
    expect(weightedAverage(20, 2, 30, 8)).toBe(28);
  });

  it('is just the new cost when nothing was on the shelf', () => {
    expect(weightedAverage(99, 0, 23, 4)).toBe(23);
  });
});

describe('estimateLanded', () => {
  const eur = (extra: number, method: 'by_quantity' | 'by_value' = 'by_quantity') => ({ currencyPerEur: 1, extraCostsEur: extra, method });

  it('spreads the trip costs over the items the trip is expected to bring, not just the first few entered', () => {
    // €300 of trip costs, about 150 items: €2 each, even for the first 6 entered.
    expect(estimateLanded([], { qty: 6, unitPrice: 10 }, eur(300), 150)).toEqual({ unitPriceEur: 10, extraEur: 2, landedEur: 12, spreadOver: 150 });
    // Not told how many: only what's entered so far.
    expect(estimateLanded([], { qty: 6, unitPrice: 10 }, eur(300), null)).toMatchObject({ extraEur: 50, spreadOver: 6 });
  });

  it('uses the real count once more than expected are entered', () => {
    expect(estimateLanded([{ qty: 194, unitPrice: 8 }], { qty: 6, unitPrice: 10 }, eur(300), 150)).toMatchObject({ extraEur: 1.5, spreadOver: 200 });
  });

  it('by price: assumes the items still to come cost what the ones entered did, on average', () => {
    // 16 entered worth €260; 160 expected, so about €2,600 of goods carry the €300.
    const e = estimateLanded([{ qty: 10, unitPrice: 20 }], { qty: 6, unitPrice: 10 }, eur(300, 'by_value'), 160);
    expect(e.extraEur).toBeCloseTo((300 * 10) / 2600, 4);
  });

  it('works in the trip currency', () => {
    expect(estimateLanded([], { qty: 2, unitPrice: 400 }, { currencyPerEur: 40, extraCostsEur: 100, method: 'by_quantity' }, 50))
      .toEqual({ unitPriceEur: 10, extraEur: 2, landedEur: 12, spreadOver: 50 });
  });
});
