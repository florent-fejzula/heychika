import { COUNTRY_CURRENCY, DeliveryZone, bagTotals, formatMoney, formatPlain, localPrice, parseAmount, parseCount, parseRate } from './money';

const fx = { mkd_per_eur: 61.5, all_per_eur: 98, mkd_rounding: 50, all_rounding: 100 };

// Same cases as supabase/tests/access.test.js, so the shop and the database
// can never disagree about what a customer pays.
describe('localPrice', () => {
  it('leaves EUR untouched', () => {
    expect(localPrice(25, 'EUR', fx)).toBe(25);
  });

  it('rounds MKD up to the nearest 50', () => {
    expect(localPrice(25, 'MKD', fx)).toBe(1550);
    expect(localPrice(20, 'MKD', fx)).toBe(1250);
  });

  it('rounds ALL up to the nearest 100', () => {
    expect(localPrice(25, 'ALL', fx)).toBe(2500);
  });

  it('does not bump an exact multiple up a step through float noise', () => {
    // 0.1 * 3 = 0.30000000000000004 in floating point
    expect(localPrice(0.3, 'MKD', { ...fx, mkd_per_eur: 1000, mkd_rounding: 100 })).toBe(300);
  });
});

describe('formatMoney', () => {
  it('formats each currency the way a customer expects to read it', () => {
    expect(formatMoney(25, 'EUR')).toBe('€25.00');
    expect(formatMoney(1550, 'MKD')).toBe('1,550 MKD');
    expect(formatMoney(2500, 'ALL')).toBe('2,500 ALL');
  });
});

describe('parseAmount', () => {
  it('reads whole numbers and decimals with a dot or a comma', () => {
    expect(parseAmount('29')).toBe(29);
    expect(parseAmount('29.5')).toBe(29.5);
    expect(parseAmount('29,50')).toBe(29.5);
    expect(parseAmount('  12 ')).toBe(12);
    expect(parseAmount('0')).toBe(0);
  });

  it('rejects anything that is not a plain price', () => {
    for (const bad of ['', 'abc', '-5', '12.345', '1,000.50', '€20', '1e3']) {
      expect(parseAmount(bad)).toBeNull();
    }
  });
});

describe('parseRate', () => {
  it('reads rates with a dot or a comma, up to six decimals', () => {
    expect(parseRate('1.0842')).toBe(1.0842);
    expect(parseRate('38,5')).toBe(38.5);
    expect(parseRate(' 61.5 ')).toBe(61.5);
    expect(parseRate('0.123456')).toBe(0.123456);
  });

  it('rejects zero, negatives, text and too many decimals', () => {
    for (const bad of ['', '0', '0.0', '-1', 'abc', '1.1234567', '1,000.5']) {
      expect(parseRate(bad)).toBeNull();
    }
  });
});

describe('formatPlain', () => {
  it('shows two decimals and the currency code', () => {
    expect(formatPlain(1234.5, 'TRY')).toBe('1,234.50 TRY');
    expect(formatPlain(12, 'USD')).toBe('12.00 USD');
  });
});

describe('parseCount', () => {
  it('reads whole numbers', () => {
    expect(parseCount('0')).toBe(0);
    expect(parseCount(' 12 ')).toBe(12);
  });

  it('rejects decimals, negatives, text and empty', () => {
    for (const bad of ['', '1.5', '-1', 'ten', '1e3', '1234567']) expect(parseCount(bad)).toBeNull();
  });
});

describe('bagTotals', () => {
  const fx = { mkd_per_eur: 61.5, all_per_eur: 98, mkd_rounding: 50, all_rounding: 100 };
  const zone = (country: 'XK' | 'MK' | 'AL', fee: number, freeOver: number | null = null): DeliveryZone => ({
    country, currency: COUNTRY_CURRENCY[country], fee_eur: fee, free_over_eur: freeOver, est_days: null,
  });

  it('adds the items and the delivery fee in euros for Kosovo', () => {
    expect(bagTotals([{ priceEur: 25, qty: 2 }, { priceEur: 39, qty: 1 }], zone('XK', 2), fx)).toEqual({
      subtotalEur: 89, items: 89, delivery: 2, total: 91, toFreeDeliveryEur: null,
    });
  });

  it('rounds each price the way the shop shows it, then adds them up', () => {
    // €24.50 is 1506.75 MKD, shown as 1550. Two of them must cost 2 x 1550 = 3100,
    // not the pair's 3013.50 rounded to 3050.
    const t = bagTotals([{ priceEur: 24.5, qty: 2 }], zone('MK', 4), fx);
    expect(t.items).toBe(3100);
    expect(t.delivery).toBe(250);
    expect(t.total).toBe(3350);
  });

  it('makes delivery free over the threshold, and says how far off it is below it', () => {
    expect(bagTotals([{ priceEur: 30, qty: 1 }], zone('AL', 4, 50), fx)).toMatchObject({ delivery: 400, toFreeDeliveryEur: 20 });
    expect(bagTotals([{ priceEur: 50, qty: 1 }], zone('AL', 4, 50), fx)).toMatchObject({ delivery: 0, toFreeDeliveryEur: null });
  });

  it('shows free delivery as 0, never -0', () => {
    expect(Object.is(localPrice(0, 'MKD', fx), 0)).toBe(true);
    expect(Object.is(bagTotals([{ priceEur: 10, qty: 1 }], zone('MK', 0), fx).delivery, 0)).toBe(true);
    expect(formatMoney(localPrice(0, 'ALL', fx), 'ALL')).toBe('0 ALL');
  });
});
