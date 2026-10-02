import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { BuyingReport as Report, Period, Reports, buyingReport, dayLabel, periodLabel } from '../../core/reports';
import { downloadWorkbook } from '../../core/xlsx';
import { buyingSheets, fileName } from './exports';
import { PeriodChange, PeriodPicker, ReportTable, ReportsTabs, TableRow, euros, readPeriod } from './report-parts';
import { samePeriod } from './sales-report';

@Component({
  selector: 'app-buying-report',
  imports: [ReportsTabs, PeriodPicker, ReportTable],
  templateUrl: './buying-report.html',
  styleUrl: './reports.scss',
})
export class BuyingReport {
  private readonly reports = inject(Reports);
  private readonly router = inject(Router);
  private readonly today = new Date();

  readonly periodParam = input<string>(undefined, { alias: 'period' });
  readonly from = input<string>();
  readonly to = input<string>();

  // Trips are a few times a year, so a year is the useful default.
  private readonly chosen = computed(() => readPeriod(this.periodParam(), this.from(), this.to(), 'year', this.today));
  protected readonly key = computed(() => this.chosen().key);
  protected readonly period = computed(() => this.chosen().period, { equal: samePeriod });
  protected readonly label = computed(() => periodLabel(this.period()));

  protected readonly report = signal<Report | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly euros = euros;

  private request = 0;

  constructor() {
    effect(() => {
      const period = this.period();
      untracked(() => this.load(period));
    });
  }

  protected trips(r: Report): TableRow[] {
    return r.trips.map((t) => ({
      label: t.reference,
      sub: `${dayLabel(t.date)} · ${t.supplier} · ${euros(t.perItemEur)} an item`,
      link: ['/admin/stock/purchases', t.id],
      cells: [String(t.items), euros(t.extraEur, true), euros(t.totalEur, true)],
    }));
  }

  protected suppliers(r: Report): TableRow[] {
    return r.bySupplier.map((s) => ({
      label: s.label,
      sub: `${s.trips} ${s.trips === 1 ? 'trip' : 'trips'}`,
      cells: [String(s.items), euros(s.extraEur, true), euros(s.totalEur, true)],
    }));
  }

  protected foot(r: Report): string[] {
    return ['Total', String(r.totals.items), euros(r.totals.extraEur, true), euros(r.totals.totalEur, true)];
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
    if (r) downloadWorkbook(fileName('buying', this.period()), buyingSheets(r));
  }

  private async load(period: Period): Promise<void> {
    const id = ++this.request;
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = buyingReport(await this.reports.buying(period));
      if (id === this.request) this.report.set(report);
    } catch (e) {
      if (id === this.request) this.error.set((e as Error).message);
    } finally {
      if (id === this.request) this.loading.set(false);
    }
  }
}
