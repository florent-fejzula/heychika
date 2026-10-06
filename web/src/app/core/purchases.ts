import { Injectable, inject } from '@angular/core';
import { AllocationMethod } from './costing';
import { explain } from './errors';
import { t } from './i18n';
import { Supabase } from './supabase';

export type PurchaseStatus = 'draft' | 'received';
export type PurchaseCurrency = 'EUR' | 'USD' | 'TRY';

export interface PurchaseRow {
  id: number;
  reference: string;
  supplier_name: string | null;
  purchase_date: string;
  currency: PurchaseCurrency;
  /** Units of `currency` per €1. Always 1 for euros. */
  currency_per_eur: number;
  extra_costs_eur: number;
  allocation_method: AllocationMethod;
  status: PurchaseStatus;
  received_at: string | null;
  notes: string | null;
}

export interface PurchaseSummary extends PurchaseRow {
  lines: { qty: number; unit_price: number }[];
}

export type PurchaseInput = Pick<
  PurchaseRow,
  'reference' | 'supplier_name' | 'purchase_date' | 'currency' | 'currency_per_eur' | 'extra_costs_eur' | 'allocation_method' | 'notes'
>;

export interface PurchaseLine {
  id: number;
  purchase_id: number;
  variant_id: number;
  qty: number;
  unit_price: number;
  /** Filled in when the purchase is received. */
  unit_price_eur: number | null;
  allocated_extra_eur: number | null;
  unit_landed_cost_eur: number | null;
  variant: {
    sku: string;
    barcode: string;
    cost_eur: number;
    product: { id: number; name: string };
    color: { name: string; hex: string | null };
    size: { label: string; sort_order: number };
    stock: { qty_physical: number } | null;
  };
}

/** One item onto a trip (or straight into stock): see save_trip_item in the migrations. */
export interface TripItem {
  /** An existing design, or null for a new one. */
  product_id: number | null;
  category_id?: number;
  name?: string;
  show_online?: boolean;
  /** Selling price in euros, for every size listed. */
  price_eur: number;
  /** What was paid per item, in the trip's currency (euros when added by hand). */
  unit_price: number;
  /** qty 0 takes that size off the trip. */
  lines: { color_id: number; size_id: number; qty: number }[];
}

export interface SavedItem {
  product_id: number;
  purchase_id: number;
  variant_ids: number[];
}

/** What the database says is wrong with an item (invalid_item's detail), as translation keys. */
const ITEM_PROBLEM: Record<string, string> = {
  name: 'errors.item.name',
  category: 'errors.item.category',
  price: 'errors.item.price',
  unit_price: 'errors.item.unitPrice',
  lines: 'errors.item.lines',
};

function fail(error: unknown, fallback?: string): never {
  throw new Error(explain(error, fallback));
}

const first = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

@Injectable({ providedIn: 'root' })
export class Purchases {
  private readonly sb = inject(Supabase).client;

  async list(): Promise<PurchaseSummary[]> {
    const { data, error } = await this.sb
      .from('purchases')
      .select('*, lines:purchase_lines(qty, unit_price)')
      .order('purchase_date', { ascending: false })
      .order('id', { ascending: false })
      .overrideTypes<PurchaseSummary[], { merge: false }>();
    if (error) fail(error, 'errors.loadTrips');
    return data;
  }

  async get(id: number): Promise<PurchaseRow | null> {
    const { data, error } = await this.sb
      .from('purchases')
      .select('*')
      .eq('id', id)
      .maybeSingle<PurchaseRow>();
    if (error) fail(error, 'errors.loadTrip');
    return data;
  }

  async create(input: PurchaseInput): Promise<number> {
    const { data, error } = await this.sb.from('purchases').insert(input).select('id').single<{ id: number }>();
    if (error) fail(error, 'errors.createTrip');
    return data.id;
  }

  async update(id: number, input: PurchaseInput): Promise<void> {
    const { error } = await this.sb.from('purchases').update(input).eq('id', id);
    if (error) fail(error, 'errors.saveTrip');
  }

  /** Drafts only; the database refuses once a purchase has been received. */
  async remove(id: number): Promise<void> {
    const { error } = await this.sb.from('purchases').delete().eq('id', id);
    if (error) fail(error, 'errors.deleteTrip');
  }

  async lines(purchaseId: number): Promise<PurchaseLine[]> {
    const { data, error } = await this.sb
      .from('purchase_lines')
      .select(
        'id, purchase_id, variant_id, qty, unit_price, unit_price_eur, allocated_extra_eur, unit_landed_cost_eur,' +
          'variant:variants(sku, barcode, cost_eur, product:products(id, name), color:colors(name, hex), size:sizes(label, sort_order), stock(qty_physical))',
      )
      .eq('purchase_id', purchaseId)
      .order('id')
      .overrideTypes<PurchaseLine[], { merge: false }>();
    if (error) fail(error, 'errors.loadItems');
    return data.map((l) => ({ ...l, variant: { ...l.variant, stock: first(l.variant.stock) } }));
  }

  /** Adds items, or replaces the quantity and price of ones already on the trip. */
  async saveLines(purchaseId: number, rows: { variant_id: number; qty: number; unit_price: number }[]): Promise<void> {
    if (!rows.length) return;
    const { error } = await this.sb
      .from('purchase_lines')
      .upsert(rows.map((r) => ({ purchase_id: purchaseId, ...r })), { onConflict: 'purchase_id,variant_id' });
    if (error) fail(error, 'errors.saveItems');
  }

  async removeLines(purchaseId: number, variantIds: number[]): Promise<void> {
    if (!variantIds.length) return;
    const { error } = await this.sb.from('purchase_lines').delete().eq('purchase_id', purchaseId).in('variant_id', variantIds);
    if (error) fail(error, 'errors.removeItems');
  }

  /**
   * One item in one go: creates the design and any sizes it doesn't have yet, and
   * sets how many of each are on the trip. With no trip, the items go straight on
   * the shelf.
   */
  async saveItem(purchaseId: number | null, item: TripItem): Promise<SavedItem> {
    const { data, error } = await this.sb.rpc('save_trip_item', { p_purchase_id: purchaseId, p_item: item });
    if (error) {
      if (/invalid_item/.test(error.message)) throw new Error(t(ITEM_PROBLEM[error.details ?? ''] ?? 'errors.checkDetails'));
      if (/purchase_received/.test(error.message)) throw new Error(t('errors.tripReceived'));
      fail(error, 'errors.saveItem');
    }
    return data as SavedItem;
  }

  /** The markup from Settings, used to suggest a selling price from what an item cost. */
  async markup(): Promise<number> {
    const { data, error } = await this.sb.from('settings').select('default_markup_pct').single<{ default_markup_pct: number }>();
    if (error) return 50;
    return Number(data.default_markup_pct);
  }

  /** Links the barcode on an item's tag to its size. null puts it back to the SKU. */
  async linkBarcode(variantId: number, barcode: string | null): Promise<void> {
    const { error } = await this.sb.rpc('link_barcode', { p_variant_id: variantId, p_barcode: barcode });
    if (error) {
      if (/barcode_in_use/.test(error.message)) {
        throw new Error(t('errors.barcodeInUse', { sku: error.details }));
      }
      if (/invalid_barcode/.test(error.message)) throw new Error(t('errors.invalidBarcode'));
      fail(error, 'errors.linkBarcode');
    }
  }

  /** Puts the goods on the shelf and records what each item really cost. Cannot be undone. */
  async receive(id: number): Promise<void> {
    const { error } = await this.sb.rpc('receive_purchase', { p_purchase_id: id });
    if (error) fail(error, 'errors.receiveItems');
  }

  /** What arrived, per size: used to print one sticker per item. */
  async quantities(purchaseId: number): Promise<{ variant_id: number; qty: number }[]> {
    const { data, error } = await this.sb
      .from('purchase_lines')
      .select('variant_id, qty')
      .eq('purchase_id', purchaseId)
      .overrideTypes<{ variant_id: number; qty: number }[], { merge: false }>();
    if (error) fail(error, 'errors.loadItems');
    return data;
  }
}
