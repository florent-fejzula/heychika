import { Injectable, inject } from '@angular/core';
import { explain } from './errors';
import { Country, Currency } from './money';
import { Supabase } from './supabase';

export type OrderStatus =
  | 'new' | 'confirmed' | 'dispatched' | 'delivered' | 'completed'
  | 'cancelled' | 'delivery_failed' | 'returned' | 'partially_returned';
export type PaymentStatus = 'unpaid' | 'paid' | 'partially_refunded' | 'refunded';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  new: 'New',
  confirmed: 'Confirmed',
  dispatched: 'Sent',
  delivered: 'Delivered',
  completed: 'Done',
  cancelled: 'Cancelled',
  delivery_failed: 'Not delivered',
  returned: 'Returned',
  partially_returned: 'Part returned',
};

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
  delivery_city: string | null;
  created_at: string;
  lines: { qty: number }[];
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
  delivery_name: string | null;
  delivery_phone: string | null;
  delivery_city: string | null;
  delivery_address: string | null;
  delivery_postal_code: string | null;
  customer_notes: string | null;
  created_at: string;
  customer: { id: number; first_name: string; last_name: string; phone: string; orders: { count: number }[] } | null;
  lines: {
    id: number;
    variant_id: number;
    sku_snapshot: string;
    product_name_snapshot: string;
    color_snapshot: string;
    size_snapshot: string;
    qty: number;
    unit_price_eur: number;
    unit_price_in_currency: number | null;
    line_total_eur: number;
  }[];
  history: { to_status: OrderStatus; created_at: string }[];
}

function fail(error: unknown, fallback: string): never {
  throw new Error(explain(error, fallback));
}

@Injectable({ providedIn: 'root' })
export class Orders {
  private readonly sb = inject(Supabase).client;

  async list(): Promise<OrderSummary[]> {
    const { data, error } = await this.sb
      .from('orders')
      .select('id, order_number, channel, status, payment_status, country, currency, total_in_currency, delivery_name, delivery_city, created_at, lines:order_lines(qty)')
      .order('created_at', { ascending: false })
      .limit(500)
      .overrideTypes<OrderSummary[], { merge: false }>();
    if (error) fail(error, 'Couldn’t load the orders.');
    return data.map((o) => ({ ...o, total_in_currency: Number(o.total_in_currency) }));
  }

  async get(id: number): Promise<OrderDetail | null> {
    const { data, error } = await this.sb
      .from('orders')
      .select(
        '*, customer:customers(id, first_name, last_name, phone, orders(count)),' +
          'lines:order_lines(id, variant_id, sku_snapshot, product_name_snapshot, color_snapshot, size_snapshot, qty, unit_price_eur, unit_price_in_currency, line_total_eur),' +
          'history:order_status_history(to_status, created_at)',
      )
      .eq('id', id)
      .maybeSingle()
      .overrideTypes<OrderDetail, { merge: false }>();
    if (error) fail(error, 'Couldn’t load this order.');
    if (!data) return null;
    return {
      ...data,
      currency_per_eur: Number(data.currency_per_eur),
      subtotal_eur: Number(data.subtotal_eur),
      delivery_fee_eur: Number(data.delivery_fee_eur),
      total_eur: Number(data.total_eur),
      total_in_currency: Number(data.total_in_currency),
      delivery_fee_in_currency: Number(data.delivery_fee_in_currency),
      lines: [...data.lines]
        .sort((a, b) => a.id - b.id)
        .map((l) => ({
          ...l,
          unit_price_eur: Number(l.unit_price_eur),
          unit_price_in_currency: l.unit_price_in_currency === null ? null : Number(l.unit_price_in_currency),
          line_total_eur: Number(l.line_total_eur),
        })),
      history: [...data.history].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    };
  }

  /** Orders waiting to be confirmed, for the badge on the dashboard. */
  async countNew(): Promise<number> {
    const { count, error } = await this.sb.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'new');
    if (error) fail(error, 'Couldn’t count the orders.');
    return count ?? 0;
  }
}

/** A phone number as digits only, for tel: and WhatsApp links. */
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}
