import { formatMoney, formatPlain, localPrice, parseAmount, parseCount, parseRate } from './money';

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
