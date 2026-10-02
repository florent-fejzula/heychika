import { Component, computed, input, output, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Currency, formatMoney } from '../../core/money';
import { PERIODS, Period, PeriodKey, periodFor } from '../../core/reports';

// The pieces every report page shares: its tabs, the period chips, a compact
// table, and how amounts are written.

/** €1,234.50, or −€12.00 for a loss. */
export function euros(amount: number, whole = false): string {
  const text = '€' + Math.abs(amount).toLocaleString('en-GB', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  return amount < 0 && Math.abs(amount) >= (whole ? 0.5 : 0.005) ? '−' + text : text;
}

export function percent(fraction: number | null): string {
  return fraction === null ? '–' : `${Math.round(fraction * 100)}%`;
}

/** "€120.00 + 3,050 MKD", leaving out the currencies with nothing in them. */
export function inCurrencies(amounts: Record<Currency, number>): string {
  const parts = (['EUR', 'MKD', 'ALL'] as Currency[]).filter((c) => Math.abs(amounts[c]) >= 0.005).map((c) => formatMoney(amounts[c], c));
  return parts.length ? parts.join(' + ') : formatMoney(0, 'EUR');
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The period asked for in the address (?period=last_month, or ?period=custom&from=…&to=…). */
export function readPeriod(
  key: string | undefined,
  from: string | undefined,
  to: string | undefined,
  fallback: Exclude<PeriodKey, 'custom'>,
  today: Date,
): { key: PeriodKey; period: Period } {
  if (key === 'custom') {
    return { key, period: { from: from && DATE.test(from) ? from : null, to: to && DATE.test(to) ? to : null } };
  }
  const known = PERIODS.find((p) => p.key === key)?.key ?? fallback;
  return { key: known, period: periodFor(known, today) };
}

@Component({
  selector: 'app-reports-tabs',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="tabs" aria-label="Reports">
      <a routerLink="/admin/reports" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" ariaCurrentWhenActive="page">Sales</a>
      <a routerLink="/admin/reports/owed" routerLinkActive="active" ariaCurrentWhenActive="page">Owed</a>
      <a routerLink="/admin/reports/stock" routerLinkActive="active" ariaCurrentWhenActive="page">Stock</a>
      <a routerLink="/admin/reports/buying" routerLinkActive="active" ariaCurrentWhenActive="page">Buying</a>
    </nav>
  `,
  styles: `
    .tabs {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid var(--line);
    }

    a {
      padding: 10px 12px;
      margin-bottom: -1px;
      border-bottom: 2px solid transparent;
      color: var(--ink-soft);
      text-decoration: none;
      font-weight: 500;
      white-space: nowrap;
    }

    a.active {
      color: var(--ink);
      border-bottom-color: var(--accent);
    }
  `,
})
export class ReportsTabs {}

export interface PeriodChange {
  key: PeriodKey;
  from?: string | null;
  to?: string | null;
}

@Component({
  selector: 'app-period-picker',
  template: `
    <div class="chips" role="radiogroup" aria-label="Period">
      @for (p of periods; track p.key) {
        <label class="chip">
          <input type="radio" name="report-period" [checked]="key() === p.key" (change)="changed.emit({ key: p.key })" />
          {{ p.label }}
        </label>
      }
      <label class="chip">
        <input type="radio" name="report-period" [checked]="key() === 'custom'" (change)="changed.emit({ key: 'custom', from: from(), to: to() })" />
        Choose dates
      </label>
    </div>
    @if (key() === 'custom') {
      <div class="grid-2 dates">
        <label class="field">
          <span>From</span>
          <input type="date" [value]="from() ?? ''" [attr.max]="to()" (change)="changed.emit({ key: 'custom', from: $any($event.target).value || null, to: to() })" />
        </label>
        <label class="field">
          <span>To</span>
          <input type="date" [value]="to() ?? ''" [attr.min]="from()" (change)="changed.emit({ key: 'custom', from: from(), to: $any($event.target).value || null })" />
        </label>
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .chip {
      min-height: 36px;
      font-size: 0.875rem;
    }
  `,
})
export class PeriodPicker {
  readonly key = input.required<PeriodKey>();
  readonly from = input<string | null>(null);
  readonly to = input<string | null>(null);
  readonly changed = output<PeriodChange>();

  protected readonly periods = PERIODS;
}

export interface TableRow {
  label: string;
  /** A second line under the label, smaller. */
  sub?: string;
  link?: unknown[];
  cells: string[];
}

@Component({
  selector: 'app-report-table',
  imports: [RouterLink],
  template: `
    <table class="figures">
      <thead>
        <tr>
          @for (h of head(); track $index) {
            <th scope="col" [class.num]="$index > 0">{{ h }}</th>
          }
        </tr>
      </thead>
      <tbody>
        @for (r of shown(); track $index) {
          <tr>
            <th scope="row">
              @if (r.link) {
                <a [routerLink]="r.link">{{ r.label }}</a>
              } @else {
                {{ r.label }}
              }
              @if (r.sub) {
                <small>{{ r.sub }}</small>
              }
            </th>
            @for (c of r.cells; track $index) {
              <td class="num">{{ c }}</td>
            }
          </tr>
        }
      </tbody>
      @if (foot(); as f) {
        <tfoot>
          <tr>
            @for (c of f; track $index) {
              <td [class.num]="$index > 0">{{ c }}</td>
            }
          </tr>
        </tfoot>
      }
    </table>
    @if (hidden() > 0) {
      <button class="btn btn-small" type="button" (click)="all.set(true)">Show all {{ rows().length }}</button>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }

    .figures {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
      font-variant-numeric: tabular-nums;
    }

    th,
    td {
      padding: 8px 0;
      border-top: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }

    th + th,
    td,
    th + td {
      padding-left: 10px;
    }

    thead th {
      border-top: 0;
      padding-top: 0;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--ink-soft);
    }

    tbody th {
      font-weight: 500;
      overflow-wrap: anywhere;

      a {
        text-decoration: none;
      }

      small {
        display: block;
        font-weight: 400;
        font-size: 0.75rem;
        color: var(--muted);
      }
    }

    tfoot td {
      font-weight: 600;
      border-top: 2px solid var(--line);
    }

    .num {
      text-align: right;
      white-space: nowrap;
    }
  `,
})
export class ReportTable {
  readonly head = input.required<string[]>();
  readonly rows = input.required<TableRow[]>();
  readonly foot = input<string[] | null>(null);
  /** Rows shown before "Show all". */
  readonly limit = input(10);

  protected readonly all = signal(false);
  protected readonly shown = computed(() => (this.all() ? this.rows() : this.rows().slice(0, this.limit())));
  protected readonly hidden = computed(() => this.rows().length - this.shown().length);
}
