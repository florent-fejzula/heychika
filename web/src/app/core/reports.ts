import { Injectable, inject } from '@angular/core';
import { explain } from './errors';
import { COUNTRY_NAME, Country, Currency } from './money';
import { OrderStatus } from './orders';
import { Supabase, allRows } from './supabase';

// The numbers behind the Reports pages, and the rules they follow.
//
// A sale counts once the cash is in: an order is in a period by the day it was
// paid. With cash on delivery, counting what was merely sent would make every
// report a guess. Sent-but-unpaid is listed on its own, as money owed.
//
// What was sold is what the customer kept: items returned, and items handed back
// at the door, don't count. Each item sells at the price the customer actually
// saw, in their currency, turned back into euros at the order's own rate, and
// costs what it cost when it was sent (frozen on the order line then).
//
// Delivery fees are cash in, but not sales: they go to the courier.

// ---------------------------------------------------------------------------
// Periods. Days are the phone's days (Kosovo time), not UTC.

export type PeriodKey = 'month' | 'last_month' | 'year' | 'last_year' | 'all' | 'custom';

/** Inclusive calendar dates, 'YYYY-MM-DD'. null means open-ended. */
export interface Period {
  from: string | null;
  to: string | null;
}

export const PERIODS: { key: Exclude<PeriodKey, 'custom'>; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'year', label: 'This year' },
  { key: 'last_year', label: 'Last year' },
  { key: 'all', label: 'All time' },
];

export function periodFor(key: Exclude<PeriodKey, 'custom'>, today = new Date()): Period {
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (key) {
    case 'month':
      return { from: isoDate(y, m, 1), to: isoDate(y, m + 1, 0) };
    case 'last_month':
      return { from: isoDate(y, m - 1, 1), to: isoDate(y, m, 0) };
    case 'year':
      return { from: isoDate(y, 0, 1), to: isoDate(y, 11, 31) };
    case 'last_year':
      return { from: isoDate(y - 1, 0, 1), to: isoDate(y - 1, 11, 31) };
    case 'all':
      return { from: null, to: null };
  }
}

/** "1 Oct 2026 – 31 Oct 2026", "All time", "Since 3 Mar 2026". */
export function periodLabel(p: Period): string {
  if (!p.from && !p.to) return 'All time';
  if (!p.to) return `Since ${dayLabel(p.from!)}`;
  if (!p.from) return `Up to ${dayLabel(p.to)}`;
  return p.from === p.to ? dayLabel(p.from) : `${dayLabel(p.from)} – ${dayLabel(p.to)}`;
}

/** For file names: "2026-10-01_2026-10-31", "all-time". */
export function periodSlug(p: Period): string {
  if (!p.from && !p.to) return 'all-time';
  return [p.from ?? 'start', p.to ?? 'today'].join('_');
}

export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The local calendar day of a moment. */
export function localDate(at: string | Date): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return isoDate(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The moment a local day starts, for querying timestamps. */
export function startOfDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toISOString();
}

/** The moment the day after starts: the end of a period, exclusive. */
export function endOfDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d + 1).toISOString();
}

function isoDate(y: number, monthIndex: number, day: number): string {
  const d = new Date(y, monthIndex, day);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

function daysBetween(fromIso: string, today: Date): number {
  const [y, m, d] = localDate(fromIso).split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = <T>(items: T[], of: (item: T) => number) => items.reduce((total, item) => total + of(item), 0);
const fullName = (c: { first_name: string; last_name: string } | null | undefined) =>
  c ? `${c.first_name} ${c.last_name}`.trim() : '';

// ---------------------------------------------------------------------------
// Order lines: what was kept, and at what price

export interface PricedLine {
  qty: number;
  returned_qty: number;
  refused_qty: number;
  unit_price_eur: number;
  unit_price_in_currency: number | null;
}

/** Items the customer kept: not returned, not handed back at the door. */
export function soldQty(l: PricedLine): number {
  return Math.max(0, Number(l.qty) - Number(l.returned_qty) - Number(l.refused_qty));
}

/** One item's price as the customer paid it, in euros at the order's rate. */
export function unitSaleEur(l: PricedLine, currencyPerEur: number): number {
  return l.unit_price_in_currency === null || l.unit_price_in_currency === undefined
    ? Number(l.unit_price_eur)
    : Number(l.unit_price_in_currency) / (Number(currencyPerEur) || 1);
}

/** One item's price in the order's currency. */
export function unitLocal(l: PricedLine, currencyPerEur: number): number {
  return l.unit_price_in_currency === null || l.unit_price_in_currency === undefined
    ? Number(l.unit_price_eur) * Number(currencyPerEur)
    : Number(l.unit_price_in_currency);
}

/** What the courier should hand over: the total, less anything that came or was handed back. */
export function expectedCash(o: { total_in_currency: number; currency_per_eur: number; lines: PricedLine[] }): number {
  const back = sum(o.lines, (l) => (Number(l.returned_qty) + Number(l.refused_qty)) * unitLocal(l, o.currency_per_eur));
  return Math.max(0, Number(o.total_in_currency) - back);
}

// ---------------------------------------------------------------------------
// Sales

export type Channel = 'online' | 'manual';
export const CHANNEL_LABEL: Record<Channel, string> = { online: 'Online shop', manual: 'From a DM' };

export interface SaleOrderRow {
  id: number;
  order_number: string;
  channel: Channel;
  country: Country;
  currency: Currency;
  currency_per_eur: number;
  delivery_fee_eur: number;
  amount_collected: number | null;
  paid_at: string;
  customer: { first_name: string; last_name: string } | null;
  lines: (PricedLine & {
    unit_cost_eur: number | null;
    sku_snapshot: string;
    product_name_snapshot: string;
    color_snapshot: string;
    size_snapshot: string;
    variant: { product: { id: number; name: string; category: { name: string } | null } | null } | null;
  })[];
  returns: { refund_amount_eur: number; refund_amount_currency: number }[];
}

export interface SaleLine {
  paidOn: string;
  orderNumber: string;
  customer: string;
  country: Country;
  channel: Channel;
  designKey: string;
  design: string;
  category: string;
  colour: string;
  size: string;
  sku: string;
  qty: number;
  priceEur: number;
  sales: number;
  cost: number;
  profit: number;
  /** No cost was known when it was sent (stock counted in, never bought on a trip). */
  costMissing: boolean;
}

export interface SaleOrder {
  paidOn: string;
  orderNumber: string;
  customer: string;
  country: Country;
  currency: Currency;
  channel: Channel;
  items: number;
  sales: number;
  cost: number;
  profit: number;
  /** In the order's currency. */
  collected: number;
  refunded: number;
  collectedEur: number;
  refundedEur: number;
  deliveryEur: number;
}

export interface Totals {
  orders: number;
  items: number;
  sales: number;
  cost: number;
  profit: number;
}

export interface Group extends Totals {
  key: string;
  label: string;
}

export interface SalesReport extends Totals {
  /** Profit as a share of sales; null when nothing sold. */
  margin: number | null;
  /** Cash in, less refunds, in each currency as it was actually handed over. */
  cash: Record<Currency, number>;
  cashEur: number;
  refundsEur: number;
  deliveryEur: number;
  /** Items sold with no known cost, which makes the profit look higher than it is. */
  uncosted: number;
  byDesign: Group[];
  byCategory: Group[];
  byCountry: Group[];
  byChannel: Group[];
  byMonth: Group[];
  lines: SaleLine[];
  orderRows: SaleOrder[];
}

export function salesReport(rows: SaleOrderRow[]): SalesReport {
  const lines: SaleLine[] = [];
  const orderRows: SaleOrder[] = [];
  const cash: Record<Currency, number> = { EUR: 0, MKD: 0, ALL: 0 };
  let cashEur = 0;
  let refundsEur = 0;
  let deliveryEur = 0;
  let uncosted = 0;

  for (const o of rows) {
    const rate = Number(o.currency_per_eur) || 1;
    const paidOn = localDate(o.paid_at);
    const customer = fullName(o.customer);
    let items = 0;
    let sales = 0;
    let cost = 0;

    for (const l of o.lines) {
      const qty = soldQty(l);
      if (qty === 0) continue;
      const priceEur = unitSaleEur(l, rate);
      const unitCost = l.unit_cost_eur === null ? 0 : Number(l.unit_cost_eur);
      const costMissing = !(unitCost > 0);
      if (costMissing) uncosted += qty;
      const line: SaleLine = {
        paidOn,
        orderNumber: o.order_number,
        customer,
        country: o.country,
        channel: o.channel,
        designKey: String(l.variant?.product?.id ?? l.product_name_snapshot),
        design: l.variant?.product?.name ?? l.product_name_snapshot,
        category: l.variant?.product?.category?.name ?? 'Other',
        colour: l.color_snapshot,
        size: l.size_snapshot,
        sku: l.sku_snapshot,
        qty,
        priceEur: round2(priceEur),
        sales: round2(qty * priceEur),
        cost: round2(qty * unitCost),
        profit: 0,
        costMissing,
      };
      line.profit = round2(line.sales - line.cost);
      lines.push(line);
      items += qty;
      sales += line.sales;
      cost += line.cost;
    }

    const collected = Number(o.amount_collected ?? 0);
    const refunded = sum(o.returns, (r) => Number(r.refund_amount_currency));
    const refundedEur = sum(o.returns, (r) => Number(r.refund_amount_eur));
    const collectedEur = round2(collected / rate);
    const delivery = items > 0 ? Number(o.delivery_fee_eur) : 0;
    cash[o.currency] += collected - refunded;
    cashEur += collectedEur - refundedEur;
    refundsEur += refundedEur;
    deliveryEur += delivery;

    orderRows.push({
      paidOn,
      orderNumber: o.order_number,
      customer,
      country: o.country,
      currency: o.currency,
      channel: o.channel,
      items,
      sales: round2(sales),
      cost: round2(cost),
      profit: round2(sales - cost),
      collected,
      refunded,
      collectedEur,
      refundedEur: round2(refundedEur),
      deliveryEur: delivery,
    });
  }

  const totals = totalsOf(lines);
  const bySales = (a: Group, b: Group) => b.sales - a.sales || a.label.localeCompare(b.label);

  return {
    ...totals,
    margin: totals.sales > 0 ? totals.profit / totals.sales : null,
    cash: { EUR: round2(cash.EUR), MKD: round2(cash.MKD), ALL: round2(cash.ALL) },
    cashEur: round2(cashEur),
    refundsEur: round2(refundsEur),
    deliveryEur: round2(deliveryEur),
    uncosted,
    byDesign: groupLines(lines, (l) => l.designKey, (l) => l.design).sort(bySales),
    byCategory: groupLines(lines, (l) => l.category, (l) => l.category).sort(bySales),
    byCountry: groupLines(lines, (l) => l.country, (l) => COUNTRY_NAME[l.country]).sort(bySales),
    byChannel: groupLines(lines, (l) => l.channel, (l) => CHANNEL_LABEL[l.channel]).sort((a, b) =>
      a.key === b.key ? 0 : a.key === 'online' ? -1 : 1,
    ),
    byMonth: groupLines(lines, (l) => l.paidOn.slice(0, 7), (l) => monthLabel(l.paidOn)).sort((a, b) => a.key.localeCompare(b.key)),
    lines,
    orderRows,
  };
}

function totalsOf(lines: SaleLine[]): Totals {
  const sales = round2(sum(lines, (l) => l.sales));
  const cost = round2(sum(lines, (l) => l.cost));
  return {
    orders: new Set(lines.map((l) => l.orderNumber)).size,
    items: sum(lines, (l) => l.qty),
    sales,
    cost,
    profit: round2(sales - cost),
  };
}

function groupLines(lines: SaleLine[], key: (l: SaleLine) => string, label: (l: SaleLine) => string): Group[] {
  const groups = new Map<string, { label: string; lines: SaleLine[] }>();
  for (const l of lines) {
    const k = key(l);
    const g = groups.get(k);
    if (g) g.lines.push(l);
    else groups.set(k, { label: label(l), lines: [l] });
  }
  return [...groups].map(([k, g]) => ({ key: k, label: g.label, ...totalsOf(g.lines) }));
}

function monthLabel(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Money owed: sent or delivered, cash not in yet. And what's on its way back.

export interface OwedOrderRow {
  id: number;
  order_number: string;
  status: OrderStatus;
  country: Country;
  currency: Currency;
  currency_per_eur: number;
  total_in_currency: number;
  dispatched_at: string | null;
  delivered_at: string | null;
  delivery_name: string | null;
  delivery_phone: string | null;
  delivery_city: string | null;
  courier_name: string | null;
  lines: (PricedLine & { product_name_snapshot: string; color_snapshot: string; size_snapshot: string })[];
}

/** A line with items handed back at the door that haven't been checked back in yet. */
export interface HandedBackRow {
  refused_qty: number;
  product_name_snapshot: string;
  color_snapshot: string;
  size_snapshot: string;
  order: {
    id: number;
    order_number: string;
    country: Country;
    delivered_at: string | null;
    delivery_name: string | null;
    delivery_city: string | null;
  } | null;
}

export interface Owed {
  id: number;
  orderNumber: string;
  customer: string;
  phone: string;
  city: string;
  country: Country;
  currency: Currency;
  courier: string;
  /** Sent or delivered on this day. */
  since: string;
  days: number;
  due: number;
  dueEur: number;
}

export interface ComingBack {
  id: number;
  orderNumber: string;
  customer: string;
  city: string;
  country: Country;
  /** The whole parcel couldn't be delivered, or some items were handed back at the door. */
  why: 'not_delivered' | 'handed_back';
  since: string;
  days: number;
  items: { name: string; colour: string; size: string; qty: number }[];
}

export interface OwedReport {
  /** Delivered: the courier has the cash. */
  delivered: Owed[];
  /** Still out for delivery: cash to come. */
  onTheWay: Owed[];
  deliveredTotal: Record<Currency, number>;
  onTheWayTotal: Record<Currency, number>;
  deliveredEur: number;
  onTheWayEur: number;
  comingBack: ComingBack[];
}

export function owedReport(orders: OwedOrderRow[], handedBack: HandedBackRow[], today = new Date()): OwedReport {
  const delivered: Owed[] = [];
  const onTheWay: Owed[] = [];
  const comingBack: ComingBack[] = [];

  for (const o of orders) {
    if (o.status === 'delivery_failed') {
      const since = o.dispatched_at ?? o.delivered_at;
      comingBack.push({
        id: o.id,
        orderNumber: o.order_number,
        customer: o.delivery_name ?? '',
        city: o.delivery_city ?? '',
        country: o.country,
        why: 'not_delivered',
        since: since ? localDate(since) : '',
        days: since ? daysBetween(since, today) : 0,
        items: o.lines
          .filter((l) => Number(l.qty) - Number(l.returned_qty) > 0)
          .map((l) => ({ name: l.product_name_snapshot, colour: l.color_snapshot, size: l.size_snapshot, qty: Number(l.qty) - Number(l.returned_qty) })),
      });
      continue;
    }

    const isDelivered = o.status === 'delivered' || o.status === 'partially_returned';
    const since = (isDelivered ? o.delivered_at : o.dispatched_at) ?? o.dispatched_at;
    const due = expectedCash(o);
    const entry: Owed = {
      id: o.id,
      orderNumber: o.order_number,
      customer: o.delivery_name ?? '',
      phone: o.delivery_phone ?? '',
      city: o.delivery_city ?? '',
      country: o.country,
      currency: o.currency,
      courier: o.courier_name ?? '',
      since: since ? localDate(since) : '',
      days: since ? daysBetween(since, today) : 0,
      due,
      dueEur: round2(due / (Number(o.currency_per_eur) || 1)),
    };
    (isDelivered ? delivered : onTheWay).push(entry);
  }

  const byOrder = new Map<number, ComingBack>();
  for (const l of handedBack) {
    if (!l.order || !(Number(l.refused_qty) > 0)) continue;
    let entry = byOrder.get(l.order.id);
    if (!entry) {
      const since = l.order.delivered_at;
      entry = {
        id: l.order.id,
        orderNumber: l.order.order_number,
        customer: l.order.delivery_name ?? '',
        city: l.order.delivery_city ?? '',
        country: l.order.country,
        why: 'handed_back',
        since: since ? localDate(since) : '',
        days: since ? daysBetween(since, today) : 0,
        items: [],
      };
      byOrder.set(l.order.id, entry);
      comingBack.push(entry);
    }
    entry.items.push({ name: l.product_name_snapshot, colour: l.color_snapshot, size: l.size_snapshot, qty: Number(l.refused_qty) });
  }

  // Longest waiting first: those are the ones to chase.
  const oldestFirst = (a: { days: number; orderNumber: string }, b: { days: number; orderNumber: string }) =>
    b.days - a.days || a.orderNumber.localeCompare(b.orderNumber);
  delivered.sort(oldestFirst);
  onTheWay.sort(oldestFirst);
  comingBack.sort(oldestFirst);

  return {
    delivered,
    onTheWay,
    deliveredTotal: totalByCurrency(delivered),
    onTheWayTotal: totalByCurrency(onTheWay),
    deliveredEur: round2(sum(delivered, (o) => o.dueEur)),
    onTheWayEur: round2(sum(onTheWay, (o) => o.dueEur)),
    comingBack,
  };
}

function totalByCurrency(owed: Owed[]): Record<Currency, number> {
  const total: Record<Currency, number> = { EUR: 0, MKD: 0, ALL: 0 };
  for (const o of owed) total[o.currency] = round2(total[o.currency] + o.due);
  return total;
}

// ---------------------------------------------------------------------------
// Stock: what there is, and what it's worth

export interface StockReportRow {
  id: number;
  sku: string;
  active: boolean;
  price_eur: number;
  cost_eur: number;
  product: { id: number; name: string; status: 'draft' | 'active' | 'archived'; category: { name: string } | null } | null;
  color: { name: string } | null;
  size: { label: string; sort_order: number } | null;
  stock: StockQty | StockQty[] | null;
}

interface StockQty {
  qty_physical: number;
  qty_reserved: number;
  qty_available: number;
  qty_in_transit: number;
  qty_damaged: number;
  min_stock: number;
}

export interface StockLine {
  sku: string;
  designKey: string;
  design: string;
  category: string;
  colour: string;
  size: string;
  sizeOrder: number;
  forSale: boolean;
  shelf: number;
  reserved: number;
  available: number;
  road: number;
  damaged: number;
  min: number;
  costEur: number;
  priceEur: number;
  /** Shelf stock at what it cost. */
  valueCost: number;
  /** Shelf stock at its selling price. */
  valuePrice: number;
  roadCost: number;
  damagedCost: number;
}

export interface StockGroup {
  key: string;
  label: string;
  skus: number;
  shelf: number;
  available: number;
  road: number;
  damaged: number;
  valueCost: number;
  valuePrice: number;
}

export interface StockReport {
  totals: StockGroup & { reserved: number; roadCost: number; damagedCost: number; soldOut: number; low: number; uncosted: number };
  byCategory: StockGroup[];
  byDesign: StockGroup[];
  lines: StockLine[];
}

export function stockReport(rows: StockReportRow[]): StockReport {
  const lines: StockLine[] = [];
  for (const v of rows) {
    const s = Array.isArray(v.stock) ? (v.stock[0] ?? null) : v.stock;
    const q = {
      shelf: Number(s?.qty_physical ?? 0),
      reserved: Number(s?.qty_reserved ?? 0),
      available: Number(s?.qty_available ?? 0),
      road: Number(s?.qty_in_transit ?? 0),
      damaged: Number(s?.qty_damaged ?? 0),
    };
    const forSale = v.active && v.product?.status === 'active';
    // Sizes that were never stocked and aren't for sale are noise here.
    if (!forSale && q.shelf + q.road + q.damaged === 0) continue;
    const cost = Number(v.cost_eur);
    const price = Number(v.price_eur);
    lines.push({
      sku: v.sku,
      designKey: String(v.product?.id ?? v.sku),
      design: v.product?.name ?? v.sku,
      category: v.product?.category?.name ?? 'Other',
      colour: v.color?.name ?? '',
      size: v.size?.label ?? '',
      sizeOrder: v.size?.sort_order ?? 0,
      forSale,
      ...q,
      min: Number(s?.min_stock ?? 0),
      costEur: cost,
      priceEur: price,
      valueCost: round2(q.shelf * cost),
      valuePrice: round2(q.shelf * price),
      roadCost: round2(q.road * cost),
      damagedCost: round2(q.damaged * cost),
    });
  }
  lines.sort((a, b) => a.category.localeCompare(b.category) || a.design.localeCompare(b.design) || a.colour.localeCompare(b.colour) || a.sizeOrder - b.sizeOrder);

  const byValue = (a: StockGroup, b: StockGroup) => b.valueCost - a.valueCost || a.label.localeCompare(b.label);
  const all = stockGroup('all', 'All', lines);
  return {
    totals: {
      ...all,
      reserved: sum(lines, (l) => l.reserved),
      roadCost: round2(sum(lines, (l) => l.roadCost)),
      damagedCost: round2(sum(lines, (l) => l.damagedCost)),
      soldOut: lines.filter((l) => l.forSale && l.available === 0).length,
      low: lines.filter((l) => l.forSale && l.min > 0 && l.available > 0 && l.available <= l.min).length,
      uncosted: sum(lines.filter((l) => !(l.costEur > 0)), (l) => l.shelf),
    },
    byCategory: groupStock(lines, (l) => l.category, (l) => l.category).sort(byValue),
    byDesign: groupStock(lines, (l) => l.designKey, (l) => l.design).sort(byValue),
    lines,
  };
}

function stockGroup(key: string, label: string, lines: StockLine[]): StockGroup {
  return {
    key,
    label,
    skus: lines.length,
    shelf: sum(lines, (l) => l.shelf),
    available: sum(lines, (l) => l.available),
    road: sum(lines, (l) => l.road),
    damaged: sum(lines, (l) => l.damaged),
    valueCost: round2(sum(lines, (l) => l.valueCost)),
    valuePrice: round2(sum(lines, (l) => l.valuePrice)),
  };
}

function groupStock(lines: StockLine[], key: (l: StockLine) => string, label: (l: StockLine) => string): StockGroup[] {
  const groups = new Map<string, { label: string; lines: StockLine[] }>();
  for (const l of lines) {
    const k = key(l);
    const g = groups.get(k);
    if (g) g.lines.push(l);
    else groups.set(k, { label: label(l), lines: [l] });
  }
  return [...groups].map(([k, g]) => stockGroup(k, g.label, g.lines));
}

// ---------------------------------------------------------------------------
// Buying: what each trip brought in, and what it really cost

export interface PurchaseReportRow {
  id: number;
  reference: string;
  supplier_name: string | null;
  purchase_date: string;
  currency: string;
  extra_costs_eur: number;
  lines: {
    qty: number;
    unit_price: number;
    unit_price_eur: number | null;
    allocated_extra_eur: number | null;
    unit_landed_cost_eur: number | null;
    variant: {
      sku: string;
      product: { name: string; category: { name: string } | null } | null;
      color: { name: string } | null;
      size: { label: string } | null;
    } | null;
  }[];
}

export interface Trip {
  id: number;
  reference: string;
  supplier: string;
  date: string;
  currency: string;
  items: number;
  goodsEur: number;
  extraEur: number;
  totalEur: number;
  /** What one item cost on average, trip costs included. */
  perItemEur: number;
}

export interface BuyLine {
  date: string;
  reference: string;
  supplier: string;
  design: string;
  category: string;
  colour: string;
  size: string;
  sku: string;
  qty: number;
  unitPrice: number;
  currency: string;
  unitPriceEur: number;
  extraEur: number;
  landedEur: number;
  totalEur: number;
}

export interface SupplierGroup {
  key: string;
  label: string;
  trips: number;
  items: number;
  goodsEur: number;
  extraEur: number;
  totalEur: number;
}

export interface BuyingReport {
  totals: Omit<SupplierGroup, 'key' | 'label'>;
  trips: Trip[];
  bySupplier: SupplierGroup[];
  lines: BuyLine[];
}

export const NO_SUPPLIER = 'No supplier named';

export function buyingReport(rows: PurchaseReportRow[]): BuyingReport {
  const trips: Trip[] = [];
  const lines: BuyLine[] = [];

  for (const p of rows) {
    const supplier = p.supplier_name?.trim() || NO_SUPPLIER;
    let items = 0;
    let goods = 0;
    let total = 0;
    for (const l of p.lines) {
      const qty = Number(l.qty);
      const unitEur = Number(l.unit_price_eur ?? 0);
      const extra = Number(l.allocated_extra_eur ?? 0);
      const landed = l.unit_landed_cost_eur === null ? unitEur + extra : Number(l.unit_landed_cost_eur);
      items += qty;
      goods += qty * unitEur;
      total += qty * landed;
      lines.push({
        date: p.purchase_date,
        reference: p.reference,
        supplier,
        design: l.variant?.product?.name ?? '',
        category: l.variant?.product?.category?.name ?? '',
        colour: l.variant?.color?.name ?? '',
        size: l.variant?.size?.label ?? '',
        sku: l.variant?.sku ?? '',
        qty,
        unitPrice: Number(l.unit_price),
        currency: p.currency,
        unitPriceEur: round2(unitEur),
        extraEur: round2(extra),
        landedEur: round2(landed),
        totalEur: round2(qty * landed),
      });
    }
    trips.push({
      id: p.id,
      reference: p.reference,
      supplier,
      date: p.purchase_date,
      currency: p.currency,
      items,
      goodsEur: round2(goods),
      extraEur: round2(Number(p.extra_costs_eur)),
      totalEur: round2(total),
      perItemEur: items ? round2(total / items) : 0,
    });
  }
  trips.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  const suppliers = new Map<string, Trip[]>();
  for (const t of trips) suppliers.set(t.supplier, [...(suppliers.get(t.supplier) ?? []), t]);
  const supplierGroup = (key: string, list: Trip[]): SupplierGroup => ({
    key,
    label: key,
    trips: list.length,
    items: sum(list, (t) => t.items),
    goodsEur: round2(sum(list, (t) => t.goodsEur)),
    extraEur: round2(sum(list, (t) => t.extraEur)),
    totalEur: round2(sum(list, (t) => t.totalEur)),
  });
  const all = supplierGroup('', trips);

  return {
    totals: { trips: all.trips, items: all.items, goodsEur: all.goodsEur, extraEur: all.extraEur, totalEur: all.totalEur },
    trips,
    bySupplier: [...suppliers].map(([k, list]) => supplierGroup(k, list)).sort((a, b) => b.totalEur - a.totalEur),
    lines,
  };
}

// ---------------------------------------------------------------------------
// Loading

@Injectable({ providedIn: 'root' })
export class Reports {
  private readonly sb = inject(Supabase).client;

  async sales(period: Period): Promise<SaleOrderRow[]> {
    try {
      return await allRows<SaleOrderRow>((from, to) => {
        let q = this.sb
          .from('orders')
          .select(
            'id, order_number, channel, country, currency, currency_per_eur, delivery_fee_eur, amount_collected, paid_at,' +
              'customer:customers(first_name, last_name),' +
              'lines:order_lines(qty, returned_qty, refused_qty, unit_price_eur, unit_price_in_currency, unit_cost_eur,' +
              ' sku_snapshot, product_name_snapshot, color_snapshot, size_snapshot,' +
              ' variant:variants(product:products(id, name, category:categories(name)))),' +
              'returns(refund_amount_eur, refund_amount_currency)',
          )
          .not('paid_at', 'is', null);
        if (period.from) q = q.gte('paid_at', startOfDay(period.from));
        if (period.to) q = q.lt('paid_at', endOfDay(period.to));
        return q.order('id').range(from, to).overrideTypes<SaleOrderRow[], { merge: false }>();
      });
    } catch (e) {
      throw new Error(explain(e, 'Couldn’t load the sales.'));
    }
  }

  async owed(): Promise<{ orders: OwedOrderRow[]; handedBack: HandedBackRow[] }> {
    try {
      const [orders, handedBack] = await Promise.all([
        allRows<OwedOrderRow>((from, to) =>
          this.sb
            .from('orders')
            .select(
              'id, order_number, status, country, currency, currency_per_eur, total_in_currency, dispatched_at, delivered_at,' +
                'delivery_name, delivery_phone, delivery_city, courier_name,' +
                'lines:order_lines(qty, returned_qty, refused_qty, unit_price_eur, unit_price_in_currency, product_name_snapshot, color_snapshot, size_snapshot)',
            )
            .in('status', ['dispatched', 'delivered', 'partially_returned', 'delivery_failed'])
            .eq('payment_status', 'unpaid')
            .order('id')
            .range(from, to)
            .overrideTypes<OwedOrderRow[], { merge: false }>(),
        ),
        allRows<HandedBackRow>((from, to) =>
          this.sb
            .from('order_lines')
            .select(
              'refused_qty, product_name_snapshot, color_snapshot, size_snapshot,' +
                'order:orders(id, order_number, country, delivered_at, delivery_name, delivery_city)',
            )
            .gt('refused_qty', 0)
            .order('id')
            .range(from, to)
            .overrideTypes<HandedBackRow[], { merge: false }>(),
        ),
      ]);
      return { orders, handedBack };
    } catch (e) {
      throw new Error(explain(e, 'Couldn’t load what’s owed.'));
    }
  }

  async stock(): Promise<StockReportRow[]> {
    try {
      return await allRows<StockReportRow>((from, to) =>
        this.sb
          .from('variants')
          .select(
            'id, sku, active, price_eur, cost_eur, product:products(id, name, status, category:categories(name)),' +
              'color:colors(name), size:sizes(label, sort_order),' +
              'stock(qty_physical, qty_reserved, qty_available, qty_in_transit, qty_damaged, min_stock)',
          )
          .order('id')
          .range(from, to)
          .overrideTypes<StockReportRow[], { merge: false }>(),
      );
    } catch (e) {
      throw new Error(explain(e, 'Couldn’t load the stock.'));
    }
  }

  async buying(period: Period): Promise<PurchaseReportRow[]> {
    try {
      return await allRows<PurchaseReportRow>((from, to) => {
        let q = this.sb
          .from('purchases')
          .select(
            'id, reference, supplier_name, purchase_date, currency, extra_costs_eur,' +
              'lines:purchase_lines(qty, unit_price, unit_price_eur, allocated_extra_eur, unit_landed_cost_eur,' +
              ' variant:variants(sku, product:products(name, category:categories(name)), color:colors(name), size:sizes(label)))',
          )
          .eq('status', 'received');
        if (period.from) q = q.gte('purchase_date', period.from);
        if (period.to) q = q.lte('purchase_date', period.to);
        return q.order('id').range(from, to).overrideTypes<PurchaseReportRow[], { merge: false }>();
      });
    } catch (e) {
      throw new Error(explain(e, 'Couldn’t load the buying trips.'));
    }
  }
}
