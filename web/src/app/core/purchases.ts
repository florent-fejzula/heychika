import { Injectable, inject } from '@angular/core';
import { AllocationMethod } from './costing';
import { explain } from './errors';
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
    cost_eur: number;
    product: { id: number; name: string };
    color: { name: string; hex: string | null };
    size: { label: string; sort_order: number };
    stock: { qty_physical: number } | null;
  };
}

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
    if (error) fail(error, 'Couldn’t load the buying trips.');
    return data;
  }

  async get(id: number): Promise<PurchaseRow | null> {
    const { data, error } = await this.sb
      .from('purchases')
      .select('*')
      .eq('id', id)
      .maybeSingle<PurchaseRow>();
    if (error) fail(error, 'Couldn’t load this buying trip.');
    return data;
  }

  async create(input: PurchaseInput): Promise<number> {
    const { data, error } = await this.sb.from('purchases').insert(input).select('id').single<{ id: number }>();
    if (error) fail(error, 'Couldn’t create the buying trip.');
    return data.id;
  }

  async update(id: number, input: PurchaseInput): Promise<void> {
    const { error } = await this.sb.from('purchases').update(input).eq('id', id);
    if (error) fail(error, 'Couldn’t save the buying trip.');
  }

  /** Drafts only; the database refuses once a purchase has been received. */
  async remove(id: number): Promise<void> {
    const { error } = await this.sb.from('purchases').delete().eq('id', id);
    if (error) fail(error, 'Couldn’t delete the buying trip.');
  }

  async lines(purchaseId: number): Promise<PurchaseLine[]> {
    const { data, error } = await this.sb
      .from('purchase_lines')
      .select(
        'id, purchase_id, variant_id, qty, unit_price, unit_price_eur, allocated_extra_eur, unit_landed_cost_eur,' +
          'variant:variants(sku, cost_eur, product:products(id, name), color:colors(name, hex), size:sizes(label, sort_order), stock(qty_physical))',
      )
      .eq('purchase_id', purchaseId)
      .order('id')
      .overrideTypes<PurchaseLine[], { merge: false }>();
    if (error) fail(error, 'Couldn’t load the items.');
    return data.map((l) => ({ ...l, variant: { ...l.variant, stock: first(l.variant.stock) } }));
  }

  /** Adds items, or replaces the quantity and price of ones already on the trip. */
  async saveLines(purchaseId: number, rows: { variant_id: number; qty: number; unit_price: number }[]): Promise<void> {
    if (!rows.length) return;
    const { error } = await this.sb
      .from('purchase_lines')
      .upsert(rows.map((r) => ({ purchase_id: purchaseId, ...r })), { onConflict: 'purchase_id,variant_id' });
    if (error) fail(error, 'Couldn’t save the items.');
  }

  async removeLines(purchaseId: number, variantIds: number[]): Promise<void> {
    if (!variantIds.length) return;
    const { error } = await this.sb.from('purchase_lines').delete().eq('purchase_id', purchaseId).in('variant_id', variantIds);
    if (error) fail(error, 'Couldn’t remove those items.');
  }

  /** Puts the goods on the shelf and records what each item really cost. Cannot be undone. */
  async receive(id: number): Promise<void> {
    const { error } = await this.sb.rpc('receive_purchase', { p_purchase_id: id });
    if (error) fail(error, 'Couldn’t receive the items.');
  }

  /** What arrived, per size: used to print one sticker per item. */
  async quantities(purchaseId: number): Promise<{ variant_id: number; qty: number }[]> {
    const { data, error } = await this.sb
      .from('purchase_lines')
      .select('variant_id, qty')
      .eq('purchase_id', purchaseId)
      .overrideTypes<{ variant_id: number; qty: number }[], { merge: false }>();
    if (error) fail(error, 'Couldn’t load the items.');
    return data;
  }
}
