import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { I18n, TranslatePipe } from '../../core/i18n';
import { Group, Period, Reports, periodLabel, salesReport } from '../../core/reports';
import { downloadWorkbook } from '../../core/xlsx';
import { fileName, salesSheets } from './exports';
import { PeriodChange, PeriodPicker, ReportTable, ReportsTabs, TableRow, euros, inCurrencies, percent, readPeriod } from './report-parts';

@Component({
  selector: 'app-sales-report',
  imports: [ReportsTabs, PeriodPicker, ReportTable, TranslatePipe],
  templateUrl: './sales-report.html',
  styleUrl: './reports.scss',
})
export class SalesReport {
  private readonly reports = inject(Reports);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);
  private readonly today = new Date();

  readonly periodParam = input<string>(undefined, { alias: 'period' });
  readonly from = input<string>();
  readonly to = input<string>();

  private readonly chosen = computed(() => readPeriod(this.periodParam(), this.from(), this.to(), 'month', this.today));
  protected readonly key = computed(() => this.chosen().key);
  protected readonly period = computed(() => this.chosen().period, { equal: samePeriod });
  protected readonly label = computed(() => periodLabel(this.period()));

  // Worked out from the rows here rather than when they arrive, so its labels follow the language.
  private readonly data = signal<Awaited<ReturnType<Reports['sales']>> | null>(null);
  protected readonly report = computed(() => {
    const rows = this.data();
    return rows ? salesReport(rows) : null;
  });
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly euros = euros;
  protected readonly percent = percent;
  protected readonly inCurrencies = inCurrencies;
  protected readonly head = (what: string) =>
    [what, 'shop.bag.items', 'admin.reports.tab.sales', 'admin.reports.sales.profit'].map((k) => this.i18n.t(k));

  private request = 0;

  constructor() {
    effect(() => {
      const period = this.period();
      untracked(() => this.load(period));
    });
  }

  protected rows(groups: Group[]): TableRow[] {
    return groups.map((g) => ({
      label: g.label,
      sub: this.i18n.t('admin.reports.sales.groupSub', { count: g.orders, pct: percent(g.sales > 0 ? g.profit / g.sales : null) }),
      cells: [String(g.items), euros(g.sales, true), euros(g.profit, true)],
    }));
  }

  protected foot(r: ReturnType<typeof salesReport>): string[] {
    return [this.i18n.t('admin.reports.total'), String(r.items), euros(r.sales, true), euros(r.profit, true)];
  }

  protected choosePeriod(change: PeriodChange): void {
    const custom = change.key === 'custom';
    this.router.navigate([], {
      queryParams: { period: change.key, from: custom ? (change.from ?? null) : null, to: custom ? (change.to ?? null) : null },
      replaceUrl: true,
    });
  }

  protected download(): void {
    const r = this.report();
    if (r) downloadWorkbook(fileName('sales', this.period()), salesSheets(r, this.period()));
  }

  private async load(period: Period): Promise<void> {
    const id = ++this.request;
    this.loading.set(true);
    this.error.set(null);
    try {
      const rows = await this.reports.sales(period);
      if (id === this.request) this.data.set(rows);
    } catch (e) {
      if (id === this.request) this.error.set((e as Error).message);
    } finally {
      if (id === this.request) this.loading.set(false);
    }
  }
}

export function samePeriod(a: Period, b: Period): boolean {
  return a.from === b.from && a.to === b.to;
}
