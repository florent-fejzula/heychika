// Turns database and storage errors into something a shop owner can act on.
// The database raises short codes (see supabase/migrations); everything else
// falls back to a generic message rather than leaking technical text.

interface ErrorLike {
  message?: string;
  details?: string | null;
  code?: string;
}

const KNOWN: [match: RegExp, text: string][] = [
  [/variant_locked/, 'This size has stock history, so it can’t be changed or deleted. Mark it inactive instead.'],
  [/product_locked/, 'This design has sales or stock history, so its category can’t change.'],
  [/code_in_use/, 'That code is already part of existing SKUs, so it can’t be changed. The name can.'],
  [/purchase_received/, 'That purchase has already been received.'],
  [/insufficient_stock/, 'Not enough stock available.'],
  [/not_authorized/, 'You don’t have access to do that.'],
  [/permission denied|42501/, 'You don’t have access to do that.'],
];

export function explain(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  const e = (error ?? {}) as ErrorLike;
  const text = `${e.message ?? ''} ${e.details ?? ''} ${e.code ?? ''}`;

  for (const [match, message] of KNOWN) {
    if (match.test(text)) return message;
  }
  if (e.code === '23505') return 'That already exists.';
  if (e.code === '23503') return 'It’s still in use somewhere (for example in a purchase), so it can’t be removed. Mark it inactive instead.';
  if (/failed to fetch|networkerror|load failed/i.test(text)) return 'Couldn’t reach the server. Check your connection and try again.';
  return fallback;
}
