// Turns database and storage errors into something a shop owner can act on.
// The database raises short codes (see supabase/migrations); everything else
// falls back to a generic message rather than leaking technical text.
// Messages are translation keys (errors.* in src/i18n), shown in the language on screen.

import { t } from './i18n';

interface ErrorLike {
  message?: string;
  details?: string | null;
  code?: string;
}

const KNOWN: [match: RegExp, key: string][] = [
  [/variant_locked/, 'errors.variantLocked'],
  [/product_locked/, 'errors.productLocked'],
  [/code_in_use/, 'errors.codeInUse'],
  [/purchase_received/, 'errors.purchaseReceived'],
  [/insufficient_stock/, 'errors.insufficientStock'],
  [/not_authorized/, 'errors.notAuthorized'],
  [/permission denied|42501/, 'errors.notAuthorized'],
];

/** `fallback` is a translation key, for when the error isn't one we know. */
export function explain(error: unknown, fallback = 'errors.generic'): string {
  const e = (error ?? {}) as ErrorLike;
  const text = `${e.message ?? ''} ${e.details ?? ''} ${e.code ?? ''}`;

  for (const [match, message] of KNOWN) {
    if (match.test(text)) return t(message);
  }
  if (e.code === '23505') return t('errors.exists');
  if (e.code === '23503') return t('errors.inUse');
  if (/failed to fetch|networkerror|load failed/i.test(text)) return t('errors.offline');
  return t(fallback);
}
