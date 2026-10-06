import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '../../core/i18n';
import { Reports, StockGroup, StockReport as Report, stockReport } from '../../core/reports';
import { downloadWorkbook } from '../../core/xlsx';
import { fileName, stockSheets } from './exports';
import { ReportTable, ReportsTabs, TableRow, euros } from './report-parts';

@Component({
  selector: 'app-stock-report',
  imports: [RouterLink, ReportsTabs, ReportTable, TranslatePipe],
  templateUrl: './stock-report.html',
  styleUrl: './reports.scss',
})
export class StockReport {
  private readonly reports = inject(Reports);
  private readonly i18n = inject(I18n);

  // Worked out here rather than when the rows arrive, so its labels follow the language.
  private readonly data = signal<Awaited<ReturnType<Reports['stock']>> | null>(null);
  protected readonly report = computed(() => {
    const rows = this.data();
    return rows ? stockReport(rows) : null;
  });
  protected readonly error = signal<string | null>(null);

  protected readonly euros = euros;
  protected readonly head = (what: string) =>
    [what, 'admin.reports.col.onShelf', 'admin.reports.col.atCost', 'admin.reports.col.atPrice'].map((k) => this.i18n.t(k));

  constructor() {
    this.reports
      .stock()
      .then((rows) => this.data.set(rows))
      .catch((e: Error) => this.error.set(e.message));
  }

  protected rows(groups: StockGroup[]): TableRow[] {
    return groups.map((g) => ({
      label: g.label,
      sub: [
        this.i18n.t('admin.reports.stock.available', { count: g.available }),
        g.road ? this.i18n.t('admin.stock.nOnRoad', { count: g.road }) : '',
        g.damaged ? this.i18n.t('admin.stock.nDamaged', { count: g.damaged }) : '',
      ].filter(Boolean).join(' · '),
      cells: [String(g.shelf), euros(g.valueCost, true), euros(g.valuePrice, true)],
    }));
  }

  protected foot(r: Report): string[] {
    return [this.i18n.t('admin.reports.total'), String(r.totals.shelf), euros(r.totals.valueCost, true), euros(r.totals.valuePrice, true)];
  }

  protected download(): void {
    const r = this.report();
    if (r) downloadWorkbook(fileName('stock'), stockSheets(r));
  }
}
