// The order just placed in this tab, so the confirmation page can show it
// without asking for the phone number she typed a second ago. Session storage:
// gone when the tab closes, and never sent anywhere.

export interface LastOrder {
  number: string;
  phone: string;
  name: string;
}

const KEY = 'hc_last_order';

export function rememberOrder(order: LastOrder): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    // The confirmation page will ask for the phone instead.
  }
}

export function lastOrder(number: string): LastOrder | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    return saved?.number === number && typeof saved.phone === 'string' ? (saved as LastOrder) : null;
  } catch {
    return null;
  }
}
