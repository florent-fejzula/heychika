import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatCode } from '../../core/money';
import { PurchaseSummary, Purchases } from '../../core/purchases';
import { StockTabs } from './stock-tabs';

@Component({
  selector: 'app-purchase-list',
  imports: [RouterLink, StockTabs],
  templateUrl: './purchase-list.html',
  styleUrl: './purchase-list.scss',
})
export class PurchaseList {
  private readonly purchases = inject(Purchases);

  protected readonly rows = signal<PurchaseSummary[] | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly drafts = computed(() => (this.rows() ?? []).filter((p) => p.status === 'draft'));
  protected readonly received = computed(() => (this.rows() ?? []).filter((p) => p.status === 'received'));

  constructor() {
    this.purchases
      .list()
      .then((r) => this.rows.set(r))
      .catch((e: Error) => this.error.set(e.message));
  }

  protected items(p: PurchaseSummary): number {
    return p.lines.reduce((n, l) => n + l.qty, 0);
  }

  protected goods(p: PurchaseSummary): string {
    return formatCode(
      p.lines.reduce((sum, l) => sum + l.qty * Number(l.unit_price), 0),
      p.currency,
    );
  }

  protected trip(p: PurchaseSummary): string {
    return formatCode(Number(p.extra_costs_eur), 'EUR');
  }

  protected date(p: PurchaseSummary): string {
    return new Date(p.purchase_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
