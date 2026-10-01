import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatMoney } from '../../core/money';
import { Supabase } from '../../core/supabase';

interface StockRow {
  qty_physical: number;
  qty_available: number;
  qty_in_transit: number;
  min_stock: number;
  variant: { sku: string; cost_eur: number } | null;
}

interface Summary {
  designs: number;
  unitsOnShelf: number;
  unitsOnTheRoad: number;
  stockValue: string;
  lowStock: { sku: string; available: number }[];
  awaitingCash: number;
  awaitingCashValue: string;
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly supabase = inject(Supabase).client;

  protected readonly summary = signal<Summary | null>(null);
  protected readonly error = signal(false);

  constructor() {
    this.load().catch(() => this.error.set(true));
  }

  private async load(): Promise<void> {
    const [products, stock, unpaid] = await Promise.all([
      this.supabase.from('products').select('*', { count: 'exact', head: true }).neq('status', 'archived'),
      this.supabase
        .from('stock')
        .select('qty_physical, qty_available, qty_in_transit, min_stock, variant:variants(sku, cost_eur)')
        .returns<StockRow[]>(),
      // Money only counts once it's collected: shipped-but-unpaid COD orders are listed separately.
      this.supabase
        .from('orders')
        .select('total_eur')
        .in('status', ['dispatched', 'delivered'])
        .eq('payment_status', 'unpaid'),
    ]);
    if (products.error || stock.error || unpaid.error) throw new Error('load failed');

    const rows = stock.data ?? [];
    const value = rows.reduce((sum, r) => sum + r.qty_physical * Number(r.variant?.cost_eur ?? 0), 0);
    const owed = (unpaid.data ?? []).reduce((sum, o) => sum + Number(o.total_eur), 0);

    this.summary.set({
      designs: products.count ?? 0,
      unitsOnShelf: rows.reduce((sum, r) => sum + r.qty_physical, 0),
      unitsOnTheRoad: rows.reduce((sum, r) => sum + r.qty_in_transit, 0),
      stockValue: formatMoney(value, 'EUR'),
      lowStock: rows
        .filter((r) => r.min_stock > 0 && r.qty_available <= r.min_stock)
        .map((r) => ({ sku: r.variant?.sku ?? '?', available: r.qty_available }))
        .sort((a, b) => a.available - b.available),
      awaitingCash: unpaid.data?.length ?? 0,
      awaitingCashValue: formatMoney(owed, 'EUR'),
    });
  }
}
