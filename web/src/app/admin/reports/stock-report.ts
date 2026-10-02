import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Reports, StockGroup, StockReport as Report, stockReport } from '../../core/reports';
import { downloadWorkbook } from '../../core/xlsx';
import { fileName, stockSheets } from './exports';
import { ReportTable, ReportsTabs, TableRow, euros } from './report-parts';

@Component({
  selector: 'app-stock-report',
  imports: [RouterLink, ReportsTabs, ReportTable],
  templateUrl: './stock-report.html',
  styleUrl: './reports.scss',
})
export class StockReport {
  private readonly reports = inject(Reports);

  protected readonly report = signal<Report | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly euros = euros;
  protected readonly head = (what: string) => [what, 'On shelf', 'At cost', 'At price'];

  constructor() {
    this.reports
      .stock()
      .then((rows) => this.report.set(stockReport(rows)))
      .catch((e: Error) => this.error.set(e.message));
  }

  protected rows(groups: StockGroup[]): TableRow[] {
    return groups.map((g) => ({
      label: g.label,
      sub: [
        `${g.available} available`,
        g.road ? `${g.road} on the road` : '',
        g.damaged ? `${g.damaged} damaged` : '',
      ].filter(Boolean).join(' · '),
      cells: [String(g.shelf), euros(g.valueCost, true), euros(g.valuePrice, true)],
    }));
  }

  protected foot(r: Report): string[] {
    return ['Total', String(r.totals.shelf), euros(r.totals.valueCost, true), euros(r.totals.valuePrice, true)];
  }

  protected download(): void {
    const r = this.report();
    if (r) downloadWorkbook(fileName('stock'), stockSheets(r));
  }
}
