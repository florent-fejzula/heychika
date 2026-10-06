import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '../../core/i18n';
import { COUNTRY_NAME, formatMoney } from '../../core/money';
import { Owed, OwedReport as Report, Reports, dayLabel, owedReport } from '../../core/reports';
import { downloadWorkbook } from '../../core/xlsx';
import { fileName, owedSheets } from './exports';
import { ReportsTabs, euros, inCurrencies } from './report-parts';

/** After this many days, money still not in (or a parcel not back) is worth a call. */
export const CHASE_AFTER_DAYS = 7;

@Component({
  selector: 'app-owed-report',
  imports: [RouterLink, ReportsTabs, TranslatePipe],
  templateUrl: './owed-report.html',
  styleUrl: './reports.scss',
})
export class OwedReport {
  private readonly reports = inject(Reports);
  private readonly i18n = inject(I18n);

  protected readonly report = signal<Report | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly euros = euros;
  protected readonly inCurrencies = inCurrencies;
  protected readonly dayLabel = dayLabel;
  protected readonly countryName = COUNTRY_NAME;
  protected readonly chaseAfter = CHASE_AFTER_DAYS;

  constructor() {
    this.reports
      .owed()
      .then(({ orders, handedBack }) => this.report.set(owedReport(orders, handedBack)))
      .catch((e: Error) => this.error.set(e.message));
  }

  protected due(o: Owed): string {
    return formatMoney(o.due, o.currency);
  }

  protected ago(days: number): string {
    return this.i18n.t(days === 0 ? 'admin.reports.owed.today' : days === 1 ? 'admin.reports.owed.yesterday' : 'admin.reports.owed.daysAgo', { count: days });
  }

  protected download(): void {
    const r = this.report();
    if (r) downloadWorkbook(fileName('money-owed'), owedSheets(r));
  }
}
