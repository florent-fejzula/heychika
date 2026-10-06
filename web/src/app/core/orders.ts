import { Injectable, inject } from '@angular/core';
import { explain } from './errors';
import { t } from './i18n';
import { Country, Currency, DeliveryZone, FxSettings } from './money';
import { Supabase, allRows } from './supabase';

export type OrderStatus =
  | 'new' | 'confirmed' | 'dispatched' | 'delivered' | 'completed'
  | 'cancelled' | 'delivery_failed' | 'returned' | 'partially_returned';
export type PaymentStatus = 'unpaid' | 'paid' | 'partially_refunded' | 'refunded';
export type ReturnCondition = 'saleable' | 'damaged';

/** The name of each status on screen, as a translation key: {{ STATUS_LABEL[o.status] | t }}. */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  new: 'admin.orderStatus.new',
  confirmed: 'admin.orderStatus.confirmed',
  dispatched: 'admin.orderStatus.dispatched',
  delivered: 'admin.orderStatus.delivered',
  completed: 'admin.orderStatus.completed',
  cancelled: 'admin.orderStatus.cancelled',
  delivery_failed: 'admin.orderStatus.delivery_failed',
  returned: 'admin.orderStatus.returned',
  partially_returned: 'admin.orderStatus.partially_returned',
};

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  unpaid: 'admin.payment.unpaid',
  paid: 'admin.payment.paid',
  partially_refunded: 'admin.payment.partially_refunded',
  refunded: 'admin.payment.refunded',
};

/**
 * Where an order sits in the day's work. The order list is grouped by this:
 * what needs a call, what needs packing, what's out with the courier, whose cash
 * hasn't arrived, and what's finished.
 */
export type Stage = 'confirm' | 'send' | 'road' | 'cash' | 'done' | 'closed';

export const STAGES: { stage: Stage; label: string }[] = [
  { stage: 'confirm', label: 'admin.orders.stage.confirm' },
  { stage: 'send', label: 'admin.orders.stage.send' },
  { stage: 'road', label: 'admin.orders.stage.road' },
  { stage: 'cash', label: 'admin.orders.stage.cash' },
  { stage: 'done', label: 'admin.orders.stage.done' },
  { stage: 'closed', label: 'admin.orders.stage.closed' },
];

export function stageOf(o: { status: OrderStatus; payment_status: PaymentStatus }): Stage {
  switch (o.status) {
    case 'new':
      return 'confirm';
    case 'confirmed':
      return 'send';
    case 'dispatched':
    case 'delivery_failed':
      return 'road';
    case 'delivered':
      return 'cash';
    case 'partially_returned':
      return o.payment_status === 'unpaid' ? 'cash' : 'done';
    case 'completed':
      return 'done';
    default:
      return 'closed';
  }
}

export interface OrderSummary {
  id: number;
  order_number: string;
  channel: 'online' | 'manual';
  status: OrderStatus;
  payment_status: PaymentStatus;
  country: Country;
  currency: Currency;
  total_in_currency: number;
  delivery_name: string | null;
  delivery_phone: string | null;
  delivery_city: string | null;
  created_at: string;
  lines: { qty: number }[];
}

export interface OrderLine {
  id: number;
  variant_id: number;
  sku_snapshot: string;
  product_name_snapshot: string;
  color_snapshot: string;
  size_snapshot: string;
  qty: number;
  returned_qty: number;
  refused_qty: number;
  default_price_eur: number;
  unit_price_eur: number;
  unit_price_in_currency: number | null;
  line_total_eur: number;
  unit_cost_eur: number | null;
  /** The barcode on the item's sticker, for checking the right thing goes in the parcel. */
  variant: { barcode: string } | null;
}

export interface OrderReturn {
  id: number;
  return_number: string;
  reason: string;
  refund_amount_currency: number;
  refund_method: string | null;
  notes: string | null;
  created_at: string;
  lines: { order_line_id: number; qty: number; condition: ReturnCondition }[];
}

export interface OrderDetail {
  id: number;
  order_number: string;
  channel: 'online' | 'manual';
  status: OrderStatus;
  payment_status: PaymentStatus;
  country: Country;
  currency: Currency;
  currency_per_eur: number;
  subtotal_eur: number;
  delivery_fee_eur: number;
  total_eur: number;
  total_in_currency: number;
  delivery_fee_in_currency: number;
  amount_collected: number | null;
  delivery_name: string | null;
  delivery_phone: string | null;
  delivery_city: string | null;
  delivery_address: string | null;
  delivery_postal_code: string | null;
  delivery_notes: string | null;
  customer_notes: string | null;
  courier_name: string | null;
  tracking_ref: string | null;
  cancelled_reason: string | null;
  locked: boolean;
  created_at: string;
  customer: { id: number; first_name: string; last_name: string; phone: string; orders: { count: number }[] } | null;
  lines: OrderLine[];
  history: { to_status: OrderStatus; to_payment_status: PaymentStatus; note: string | null; created_at: string }[];
  returns: OrderReturn[];
}

export interface Customer {
  id: number;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  country: Country;
  city: string;
  address: string;
  postal_code: string | null;
  notes: string | null;
  created_at: string;
}

export interface CustomerSummary extends Customer {
  orders: { id: number; status: OrderStatus; payment_status: PaymentStatus; total_eur: number; created_at: string }[];
}

export interface CustomerDetail extends Customer {
  orders: (OrderSummary & { total_eur: number })[];
}

/** A size that can go on an order typed in by hand. */
export interface SellableItem {
  id: number;
  sku: string;
  barcode: string;
  price_eur: number;
  product: { id: number; name: string; status: string };
  color: { name: string; hex: string | null; sort_order: number };
  size: { label: string; sort_order: number };
  available: number;
}

export interface CustomerInput {
  id?: number;
  first_name: string;
  last_name: string;
  phone: string;
  city: string;
  address: string;
  postal_code: string;
}

/** One line of an order typed in by hand. `price` is per item, in the order's currency; null for the usual price. */
export interface LineInput {
  variant_id: number;
  qty: number;
  price?: number | null;
}

// What invalid_order's detail can name; each has errors.order.field.<name> in src/i18n.
const INVALID_ORDER = ['first_name', 'phone', 'city', 'address', 'reason', 'empty', 'qty', 'price', 'delivery_fee', 'amount', 'refused', 'nothing_delivered'];

// Error codes from the order functions (supabase/migrations/20261005000001_order_flow.sql).
const ORDER_ERRORS: [RegExp, (detail: string, hint: string) => string][] = [
  [/invalid_status/, () => t('errors.order.movedOn')],
  [/insufficient_stock/, (_, hint) => t('errors.order.notEnough', { count: hint || 0 })],
  [/not_available/, () => t('errors.order.notAvailable')],
  [/invalid_return/, (detail) =>
    t(detail === 'reason' ? 'errors.return.reason'
      : detail === 'refund' ? 'errors.return.refund'
        : /nothing was paid/.test(detail) ? 'errors.return.nothingPaid'
          : /more than was paid/.test(detail) ? 'errors.return.moreThanPaid'
            : 'errors.return.check')],
  [/invalid_order/, (detail) =>
    t(INVALID_ORDER.includes(detail) ? `errors.order.field.${detail}` : 'errors.checkDetails')],
];

interface DbError {
  message?: string;
  details?: string | null;
  hint?: string | null;
}

function fail(error: unknown, fallback: string): never {
  const e = (error ?? {}) as DbError;
  for (const [match, text] of ORDER_ERRORS) {
    if (match.test(e.message ?? '')) throw new Error(text(e.details ?? '', e.hint ?? ''));
  }
  throw new Error(explain(error, fallback));
}

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

@Injectable({ providedIn: 'root' })
export class Orders {
  private readonly sb = inject(Supabase).client;

  // ---------------------------------------------------------------- reading

  async list(): Promise<OrderSummary[]> {
    // All of them, not the newest thousand: an old order whose cash never came must
    // still show under Cash due.
    const data = await allRows<OrderSummary>((from, to) =>
      this.sb
        .from('orders')
        .select('id, order_number, channel, status, payment_status, country, currency, total_in_currency, delivery_name, delivery_phone, delivery_city, created_at, lines:order_lines(qty)')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
        .overrideTypes<OrderSummary[], { merge: false }>(),
    ).catch((e) => fail(e, 'errors.loadOrders'));
    return data.map((o) => ({ ...o, total_in_currency: num(o.total_in_currency) }));
  }

  async get(id: number): Promise<OrderDetail | null> {
    const { data, error } = await this.sb
      .from('orders')
      .select(
        '*, customer:customers(id, first_name, last_name, phone, orders(count)),' +
          'lines:order_lines(id, variant_id, sku_snapshot, product_name_snapshot, color_snapshot, size_snapshot, qty, returned_qty, refused_qty,' +
          ' default_price_eur, unit_price_eur, unit_price_in_currency, line_total_eur, unit_cost_eur, variant:variants(barcode)),' +
          'history:order_status_history(to_status, to_payment_status, note, created_at),' +
          'returns(id, return_number, reason, refund_amount_currency, refund_method, notes, created_at, lines:return_lines(order_line_id, qty, condition))',
      )
      .eq('id', id)
      .maybeSingle()
      .overrideTypes<OrderDetail, { merge: false }>();
    if (error) fail(error, 'errors.loadOrder');
    if (!data) return null;
    return {
      ...data,
      currency_per_eur: num(data.currency_per_eur),
      subtotal_eur: num(data.subtotal_eur),
      delivery_fee_eur: num(data.delivery_fee_eur),
      total_eur: num(data.total_eur),
      total_in_currency: num(data.total_in_currency),
      delivery_fee_in_currency: num(data.delivery_fee_in_currency),
      amount_collected: numOrNull(data.amount_collected),
      lines: [...data.lines]
        .sort((a, b) => a.id - b.id)
        .map((l) => ({
          ...l,
          default_price_eur: num(l.default_price_eur),
          unit_price_eur: num(l.unit_price_eur),
          unit_price_in_currency: numOrNull(l.unit_price_in_currency),
          line_total_eur: num(l.line_total_eur),
          unit_cost_eur: numOrNull(l.unit_cost_eur),
        })),
      history: [...data.history].sort((a, b) => a.created_at.localeCompare(b.created_at)),
      returns: [...(data.returns ?? [])]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((r) => ({ ...r, refund_amount_currency: num(r.refund_amount_currency) })),
    };
  }

  /** Everything that could go on an order typed in by hand: active sizes of designs that aren't retired. */
  async sellable(): Promise<SellableItem[]> {
    type Row = Omit<SellableItem, 'available'> & { active: boolean; stock: { qty_available: number } | { qty_available: number }[] | null };
    const data = await allRows<Row>((from, to) =>
      this.sb
        .from('variants')
        .select('id, sku, barcode, price_eur, active, product:products(id, name, status), color:colors(name, hex, sort_order), size:sizes(label, sort_order), stock(qty_available)')
        .eq('active', true)
        .order('id')
        .range(from, to)
        .overrideTypes<Row[], { merge: false }>(),
    ).catch((e) => fail(e, 'errors.loadProducts'));
    return data
      .filter((v) => v.product.status !== 'archived')
      .map(({ stock, active: _a, ...v }) => {
        const row = Array.isArray(stock) ? stock[0] : stock;
        return { ...v, price_eur: num(v.price_eur), available: Math.max(0, row?.qty_available ?? 0) };
      })
      .sort((a, b) =>
        a.product.name.localeCompare(b.product.name) ||
        a.color.sort_order - b.color.sort_order ||
        a.size.sort_order - b.size.sort_order);
  }

  /** Exchange rates and delivery fees, for pricing an order typed in by hand. */
  async pricing(): Promise<{ fx: FxSettings; zones: DeliveryZone[] }> {
    const [settings, zones] = await Promise.all([
      this.sb.from('settings').select('mkd_per_eur, all_per_eur, mkd_rounding, all_rounding').single<FxSettings>(),
      this.sb.from('delivery_zones').select('country, currency, fee_eur, free_over_eur, est_days').overrideTypes<DeliveryZone[], { merge: false }>(),
    ]);
    if (settings.error || zones.error) fail(settings.error ?? zones.error, 'errors.loadPrices');
    const s = settings.data;
    return {
      fx: { mkd_per_eur: num(s.mkd_per_eur), all_per_eur: num(s.all_per_eur), mkd_rounding: num(s.mkd_rounding), all_rounding: num(s.all_rounding) },
      zones: zones.data.map((z) => ({ ...z, fee_eur: num(z.fee_eur), free_over_eur: numOrNull(z.free_over_eur) })),
    };
  }

  /** Orders waiting to be confirmed, for the badge on the dashboard. */
  async countNew(): Promise<number> {
    const { count, error } = await this.sb.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'new');
    if (error) fail(error, 'errors.countOrders');
    return count ?? 0;
  }

  // ---------------------------------------------------------------- customers

  async customers(): Promise<CustomerSummary[]> {
    const data = await allRows<CustomerSummary>((from, to) =>
      this.sb
        .from('customers')
        .select('*, orders(id, status, payment_status, total_eur, created_at)')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
        .overrideTypes<CustomerSummary[], { merge: false }>(),
    ).catch((e) => fail(e, 'errors.loadCustomers'));
    return data.map((c) => ({ ...c, orders: c.orders.map((o) => ({ ...o, total_eur: num(o.total_eur) })) }));
  }

  async customer(id: number): Promise<CustomerDetail | null> {
    const { data, error } = await this.sb
      .from('customers')
      .select('*, orders(id, order_number, channel, status, payment_status, country, currency, total_in_currency, total_eur, delivery_name, delivery_phone, delivery_city, created_at, lines:order_lines(qty))')
      .eq('id', id)
      .maybeSingle<CustomerDetail>();
    if (error) fail(error, 'errors.loadCustomer');
    if (!data) return null;
    return {
      ...data,
      orders: [...data.orders]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((o) => ({ ...o, total_in_currency: num(o.total_in_currency), total_eur: num(o.total_eur) })),
    };
  }

  /** Customers whose phone contains these digits: the quick way to find a repeat buyer. */
  async findByPhone(digits: string): Promise<Customer[]> {
    const clean = digits.replace(/\D/g, '');
    if (clean.length < 4) return [];
    // The last digits are what people remember, and they survive +383 vs 0 at the start.
    const { data, error } = await this.sb
      .from('customers')
      .select('*')
      .like('phone_digits', `%${clean.replace(/^0+/, '')}%`)
      .order('created_at', { ascending: false })
      .limit(8)
      .overrideTypes<Customer[], { merge: false }>();
    if (error) fail(error, 'errors.searchCustomers');
    return data;
  }

  async updateCustomer(id: number, patch: Partial<Pick<Customer, 'first_name' | 'last_name' | 'phone' | 'email' | 'city' | 'address' | 'postal_code' | 'notes'>>): Promise<void> {
    const { error } = await this.sb.from('customers').update(patch).eq('id', id);
    if (error) fail(error, 'errors.saveCustomer');
  }

  // ---------------------------------------------------------------- the journey

  confirm(id: number): Promise<void> {
    return this.call('confirm_order', { p_order_id: id }, 'errors.confirmOrder');
  }

  cancel(id: number, reason: string): Promise<void> {
    return this.call('cancel_order', { p_order_id: id, p_reason: reason }, 'errors.cancelOrder');
  }

  dispatch(id: number, courier: string, tracking: string): Promise<void> {
    return this.call('dispatch_order', { p_order_id: id, p_courier: courier || null, p_tracking: tracking || null }, 'errors.markSent');
  }

  /** `refused`: items handed back at the door. `amount`: cash collected, if it's known now. */
  markDelivered(id: number, refused: { order_line_id: number; qty: number }[], amount: number | null): Promise<void> {
    return this.call('mark_delivered', { p_order_id: id, p_refused: refused, p_amount_collected: amount }, 'errors.markDelivered');
  }

  recordPayment(id: number, amount: number): Promise<void> {
    return this.call('record_payment', { p_order_id: id, p_amount: amount }, 'errors.recordPayment');
  }

  markFailed(id: number, note: string): Promise<void> {
    return this.call('mark_delivery_failed', { p_order_id: id, p_note: note || null }, 'errors.saveThat');
  }

  retry(id: number, note: string): Promise<void> {
    return this.call('retry_delivery', { p_order_id: id, p_note: note || null }, 'errors.saveThat');
  }

  async recordReturn(
    id: number,
    lines: { order_line_id: number; qty: number; condition: ReturnCondition }[],
    reason: string,
    refund: number,
    method: string,
    notes: string,
  ): Promise<string> {
    const { data, error } = await this.sb.rpc('record_return', {
      p_order_id: id, p_lines: lines, p_reason: reason, p_refund: refund, p_refund_method: method || null, p_notes: notes || null,
    });
    if (error) fail(error, 'errors.recordReturn');
    return data as string;
  }

  updateDetails(id: number, details: Record<string, string>): Promise<void> {
    return this.call('update_order_details', { p_order_id: id, p_details: details }, 'errors.saveDetails');
  }

  /** `fee`: delivery fee in the order's currency; null keeps the current one. */
  editItems(id: number, lines: LineInput[], fee: number | null): Promise<void> {
    return this.call('edit_order_items', { p_order_id: id, p_lines: lines, p_delivery_fee: fee }, 'errors.changeItems');
  }

  async createManual(country: Country, customer: CustomerInput, lines: LineInput[], fee: number | null, notes: string): Promise<{ id: number; order_number: string }> {
    const { data, error } = await this.sb.rpc('create_manual_order', {
      p_country: country, p_customer: customer, p_lines: lines, p_delivery_fee: fee, p_notes: notes || null,
    });
    if (error) fail(error, 'errors.createOrder');
    return data as { id: number; order_number: string };
  }

  private async call(fn: string, args: Record<string, unknown>, fallback: string): Promise<void> {
    const { error } = await this.sb.rpc(fn, args);
    if (error) fail(error, fallback);
  }
}

/** A phone number as digits only, for tel: and WhatsApp links. */
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}
