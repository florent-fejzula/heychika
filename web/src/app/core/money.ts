export type Currency = 'EUR' | 'MKD' | 'ALL';
export type Country = 'XK' | 'MK' | 'AL';

export const COUNTRY_CURRENCY: Record<Country, Currency> = { XK: 'EUR', MK: 'MKD', AL: 'ALL' };
export const COUNTRY_NAME: Record<Country, string> = { XK: 'Kosovo', MK: 'North Macedonia', AL: 'Albania' };

// Rates are units per 1 EUR, the way people quote them: 61.5 MKD, 98 ALL.
export interface FxSettings {
  mkd_per_eur: number;
  all_per_eur: number;
  mkd_rounding: number;
  all_rounding: number;
}

// Must match public.local_price() in the database, which is what orders use.
// Converted prices round *up* to a clean step: EUR 25 -> 1537.50 MKD -> 1550 MKD.
export function localPrice(eur: number, currency: Currency, fx: FxSettings): number {
  if (currency === 'EUR') return eur;
  const [rate, step] = currency === 'MKD' ? [fx.mkd_per_eur, fx.mkd_rounding] : [fx.all_per_eur, fx.all_rounding];
  // The epsilon stops float noise (e.g. 31.000000000004) from bumping an exact
  // multiple up a whole step.
  return Math.ceil((eur * rate) / step - 1e-9) * step;
}

export function formatMoney(amount: number, currency: Currency): string {
  if (currency === 'EUR') {
    return '€' + amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return amount.toLocaleString('en-GB', { maximumFractionDigits: 0 }) + ' ' + (currency === 'MKD' ? 'MKD' : 'ALL');
}

/**
 * Reads a price typed by a person. Accepts "29", "29.5", "29,50" (comma is how
 * most people here write decimals). Returns null for anything else, including
 * negatives and more than two decimals.
 */
export function parseAmount(text: string): number | null {
  const cleaned = text.trim().replace(',', '.');
  return /^\d+(\.\d{1,2})?$/.test(cleaned) ? Number(cleaned) : null;
}

/**
 * Reads an exchange rate: units of a currency per €1, up to six decimals ("1.0842",
 * "38,5"). Must be greater than zero.
 */
export function parseRate(text: string): number | null {
  const cleaned = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,6})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n > 0 ? n : null;
}

/** Any currency code, for amounts in a purchase currency that has no special format (USD, TRY). */
export function formatPlain(amount: number, code: string): string {
  return amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + code;
}

/** A whole number of items, 0 to 999,999. Returns null for anything else (including decimals and negatives). */
export function parseCount(text: string): number | null {
  const cleaned = text.trim();
  return /^\d{1,6}$/.test(cleaned) ? Number(cleaned) : null;
}

/** Formats an amount in euros or any purchase currency (USD, TRY). */
export function formatCode(amount: number, code: string): string {
  return code === 'EUR' ? formatMoney(amount, 'EUR') : formatPlain(amount, code);
}
