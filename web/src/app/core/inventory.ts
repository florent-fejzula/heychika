import { Injectable, inject } from '@angular/core';
import { explain } from './errors';
import { Supabase, allRows } from './supabase';

export interface StockRow {
  id: number;
  sku: string;
  active: boolean;
  cost_eur: number;
  product: { id: number; name: string; status: 'draft' | 'active' | 'archived' };
  color: { name: string; hex: string | null };
  size: { label: string; sort_order: number };
  stock: {
    qty_physical: number;
    qty_reserved: number;
    qty_available: number;
    qty_in_transit: number;
    qty_damaged: number;
    min_stock: number;
  } | null;
}

export type MovementType =
  | 'stock_in' | 'reserve' | 'release' | 'dispatch' | 'deliver'
  | 'return_saleable' | 'return_damaged' | 'adjust' | 'mark_damaged' | 'writeoff';

export interface Movement {
  id: number;
  type: MovementType;
  qty: number;
  delta_physical: number;
  delta_reserved: number;
  delta_in_transit: number;
  delta_damaged: number;
  ref_type: 'purchase' | 'order' | 'return' | 'adjustment' | null;
  ref_id: number | null;
  unit_cost_eur: number | null;
  note: string | null;
  user_id: string | null;
  created_at: string;
}

/** Plain-language names for the ledger, in the words the shop uses. */
export const MOVEMENT_LABEL: Record<MovementType, string> = {
  stock_in: 'Received',
  reserve: 'Reserved for an order',
  release: 'Reservation released',
  dispatch: 'Sent out',
  deliver: 'Delivered',
  return_saleable: 'Came back, fit to sell',
  return_damaged: 'Came back, damaged',
  adjust: 'Count corrected',
  mark_damaged: 'Marked damaged',
  writeoff: 'Written off',
};

function fail(error: unknown, fallback?: string): never {
  throw new Error(explain(error, fallback));
}

const first = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

@Injectable({ providedIn: 'root' })
export class Inventory {
  private readonly sb = inject(Supabase).client;

  async overview(): Promise<StockRow[]> {
    const data = await allRows<StockRow>((from, to) =>
      this.sb
        .from('variants')
        .select(
          'id, sku, active, cost_eur, product:products(id, name, status), color:colors(name, hex), size:sizes(label, sort_order),' +
            'stock(qty_physical, qty_reserved, qty_available, qty_in_transit, qty_damaged, min_stock)',
        )
        .order('id')
        .range(from, to)
        .overrideTypes<StockRow[], { merge: false }>(),
    ).catch((e) => fail(e, 'Couldn’t load the stock.'));
    return data.map((v) => ({ ...v, stock: first(v.stock) }));
  }

  async history(variantId: number): Promise<Movement[]> {
    const { data, error } = await this.sb
      .from('stock_movements')
      .select('id, type, qty, delta_physical, delta_reserved, delta_in_transit, delta_damaged, ref_type, ref_id, unit_cost_eur, note, user_id, created_at')
      .eq('variant_id', variantId)
      .order('id', { ascending: false })
      .limit(40)
      .overrideTypes<Movement[], { merge: false }>();
    if (error) fail(error, 'Couldn’t load the history.');
    return data;
  }

  /** Who made each change, for the history. Two people, so this is tiny. */
  async people(): Promise<Map<string, string>> {
    const { data } = await this.sb.from('profiles').select('id, name').overrideTypes<{ id: string; name: string }[], { merge: false }>();
    return new Map((data ?? []).map((p) => [p.id, p.name]));
  }

  /** Corrects the count on the shelf by a signed amount. A reason is required. */
  async adjust(variantId: number, delta: number, note: string): Promise<void> {
    await this.change(variantId, 'adjust', delta, note);
  }

  async markDamaged(variantId: number, qty: number, note: string): Promise<void> {
    await this.change(variantId, 'mark_damaged', qty, note);
  }

  async writeOff(variantId: number, qty: number, note: string): Promise<void> {
    await this.change(variantId, 'writeoff', qty, note);
  }

  async setMinStock(variantId: number, min: number): Promise<void> {
    const { error } = await this.sb.from('stock').update({ min_stock: min }).eq('variant_id', variantId);
    if (error) fail(error, 'Couldn’t save the low-stock level.');
  }

  private async change(variantId: number, type: 'adjust' | 'mark_damaged' | 'writeoff', qty: number, note: string): Promise<void> {
    const { error } = await this.sb.rpc('record_stock_change', { p_variant_id: variantId, p_type: type, p_qty: qty, p_note: note });
    if (error) {
      // The common failure deserves a specific answer rather than the generic one.
      if (/insufficient_stock/.test(`${error.message} ${error.details ?? ''}`)) {
        throw new Error('That would leave fewer on the shelf than are already promised to orders.');
      }
      fail(error, 'Couldn’t record that change.');
    }
  }
}
