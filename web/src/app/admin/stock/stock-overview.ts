import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Inventory, StockRow } from '../../core/inventory';
import { formatMoney } from '../../core/money';
import { StockDetail } from './stock-detail';
import { StockTabs } from './stock-tabs';

type Filter = 'all' | 'low' | 'out' | 'damaged' | 'road';

interface Group {
  id: number;
  name: string;
  rows: StockRow[];
  shelf: number;
  available: number;
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'low', label: 'Running low' },
  { id: 'out', label: 'Sold out' },
  { id: 'road', label: 'On the road' },
  { id: 'damaged', label: 'Damaged' },
];

const qty = (r: StockRow) => r.stock ?? { qty_physical: 0, qty_reserved: 0, qty_available: 0, qty_in_transit: 0, qty_damaged: 0, min_stock: 0 };

@Component({
  selector: 'app-stock-overview',
  imports: [RouterLink, StockDetail, StockTabs],
  templateUrl: './stock-overview.html',
  styleUrl: './stock-overview.scss',
})
export class StockOverview {
  private readonly inventory = inject(Inventory);

  /** From `?find=SKU`, e.g. the Scan page's “Stock details” link. */
  readonly find = input<string>();

  protected readonly filters = FILTERS;
  protected readonly rows = signal<StockRow[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly filter = signal<Filter>('all');
  protected readonly open = signal<number | null>(null);

  // Archived designs are finished with: out of the lists and the totals.
  private readonly live = computed(() => (this.rows() ?? []).filter((r) => r.product.status !== 'archived'));

  protected readonly totals = computed(() => {
    const live = this.live();
    return {
      shelf: live.reduce((n, r) => n + qty(r).qty_physical, 0),
      road: live.reduce((n, r) => n + qty(r).qty_in_transit, 0),
      damaged: live.reduce((n, r) => n + qty(r).qty_damaged, 0),
      value: live.reduce((n, r) => n + qty(r).qty_physical * Number(r.cost_eur), 0),
    };
  });

  protected readonly counts = computed<Record<Filter, number>>(() => {
    const live = this.live();
    return {
      all: live.length,
      low: live.filter((r) => this.isLow(r)).length,
      out: live.filter((r) => this.isOut(r)).length,
      road: live.filter((r) => qty(r).qty_in_transit > 0).length,
      damaged: live.filter((r) => qty(r).qty_damaged > 0).length,
    };
  });

  protected readonly groups = computed<Group[]>(() => {
    const q = this.search().trim().toLowerCase();
    const filter = this.filter();
    const byProduct = new Map<number, Group>();

    for (const r of this.live()) {
      if (filter === 'low' && !this.isLow(r)) continue;
      if (filter === 'out' && !this.isOut(r)) continue;
      if (filter === 'road' && !(qty(r).qty_in_transit > 0)) continue;
      if (filter === 'damaged' && !(qty(r).qty_damaged > 0)) continue;
      if (q && !`${r.product.name} ${r.sku} ${r.color.name}`.toLowerCase().includes(q)) continue;

      const g = byProduct.get(r.product.id) ?? { id: r.product.id, name: r.product.name, rows: [], shelf: 0, available: 0 };
      g.rows.push(r);
      g.shelf += qty(r).qty_physical;
      g.available += qty(r).qty_available;
      byProduct.set(r.product.id, g);
    }

    return [...byProduct.values()]
      .map((g) => ({ ...g, rows: g.rows.sort((a, b) => a.color.name.localeCompare(b.color.name) || a.size.sort_order - b.size.sort_order) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  constructor() {
    this.reload();
    effect(() => {
      const find = this.find();
      if (find) this.search.set(find);
    });
  }

  protected async reload(): Promise<void> {
    try {
      this.rows.set(await this.inventory.overview());
      this.error.set(null);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  /** The panel for the row that is open, found fresh so it shows the latest numbers after a change. */
  protected current(id: number): StockRow | undefined {
    return this.rows()?.find((r) => r.id === id);
  }

  protected toggle(id: number): void {
    this.open.update((current) => (current === id ? null : id));
  }

  protected isLow(r: StockRow): boolean {
    const s = qty(r);
    return s.min_stock > 0 && s.qty_available > 0 && s.qty_available <= s.min_stock;
  }

  protected isOut(r: StockRow): boolean {
    return r.active && qty(r).qty_available <= 0;
  }

  protected s(r: StockRow) {
    return qty(r);
  }

  protected money(n: number): string {
    return formatMoney(n, 'EUR');
  }
}
