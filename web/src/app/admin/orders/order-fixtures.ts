// Test data for the order screens' specs. Plain data only, no test framework, so it
// type-checks with the app.

import { OrderDetail, OrderLine, OrderSummary, SellableItem } from '../../core/orders';

export function summary(id: number, status: OrderSummary['status'], name: string, extra: Partial<OrderSummary> = {}): OrderSummary {
  return {
    id, order_number: `HC-2026-000${id}`, channel: 'online', status, payment_status: 'unpaid', country: 'MK', currency: 'MKD',
    total_in_currency: 3350, delivery_name: name, delivery_phone: '+38970123456', delivery_city: 'Skopje',
    created_at: '2026-09-30T10:00:00Z', lines: [{ qty: 2 }, { qty: 1 }], ...extra,
  };
}

export function line(id: number, name: string, size: string, qty: number, extra: Partial<OrderLine> = {}): OrderLine {
  const sku = `DR-00${id}-BLK-${size}`;
  return {
    id, variant_id: id * 10, sku_snapshot: sku, product_name_snapshot: name, color_snapshot: 'Black', size_snapshot: size,
    qty, returned_qty: 0, refused_qty: 0, default_price_eur: 25, unit_price_eur: 25, unit_price_in_currency: 1550,
    line_total_eur: 25 * qty, unit_cost_eur: null, variant: { barcode: sku }, ...extra,
  };
}

/** Arta's order: 2 wrap dresses (M) and 1 silk top (S), to Skopje. 1550 x 2 + 1550 + 250 delivery. */
export function order(extra: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 7, order_number: 'HC-2026-0007', channel: 'online', status: 'new', payment_status: 'unpaid', country: 'MK', currency: 'MKD',
    currency_per_eur: 61.5, subtotal_eur: 75, delivery_fee_eur: 4, total_eur: 79, total_in_currency: 4900, delivery_fee_in_currency: 250,
    amount_collected: null,
    delivery_name: 'Arta Krasniqi', delivery_phone: '+38970123456', delivery_city: 'Skopje', delivery_address: 'Ul. Makedonija 5',
    delivery_postal_code: '1000', delivery_notes: null, customer_notes: 'call after 5', courier_name: null, tracking_ref: null,
    cancelled_reason: null, locked: false, created_at: '2026-10-01T10:00:00Z',
    customer: { id: 1, first_name: 'Arta', last_name: 'Krasniqi', phone: '+38970123456', orders: [{ count: 3 }] },
    lines: [line(1, 'Wrap dress', 'M', 2), line(2, 'Silk top', 'S', 1)],
    history: [{ to_status: 'new', to_payment_status: 'unpaid', note: null, created_at: '2026-10-01T10:00:00Z' }],
    returns: [],
    ...extra,
  };
}

export function sellable(id: number, name: string, color: string, size: string, available: number, price = 25): SellableItem {
  const sku = `DR-${String(id).padStart(3, '0')}-${color.slice(0, 3).toUpperCase()}-${size}`;
  return {
    id, sku, barcode: sku, price_eur: price,
    product: { id: Math.floor(id / 10), name, status: 'active' },
    color: { name: color, hex: '#111', sort_order: 10 },
    size: { label: size, sort_order: size === 'S' ? 20 : 30 },
    available,
  };
}

export const PRICING = {
  fx: { mkd_per_eur: 61.5, all_per_eur: 98, mkd_rounding: 50, all_rounding: 100 },
  zones: [
    { country: 'XK' as const, currency: 'EUR' as const, fee_eur: 2, free_over_eur: null, est_days: null },
    { country: 'MK' as const, currency: 'MKD' as const, fee_eur: 4, free_over_eur: null, est_days: null },
    { country: 'AL' as const, currency: 'ALL' as const, fee_eur: 4, free_over_eur: null, est_days: null },
  ],
};
