import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../core/i18n';
import { COUNTRY_NAME, formatMoney } from '../../core/money';
import { CustomerSummary, Orders, phoneDigits } from '../../core/orders';
import { OrdersTabs } from '../orders/orders-tabs';

/** Orders that count as bought: paid for. */
export function spent(c: { orders: { payment_status: string; total_eur: number }[] }): number {
  return c.orders.filter((o) => o.payment_status === 'paid').reduce((sum, o) => sum + o.total_eur, 0);
}

@Component({
  selector: 'app-customer-list',
  imports: [RouterLink, OrdersTabs, TranslatePipe],
  templateUrl: './customer-list.html',
  styleUrl: './customer-list.scss',
})
export class CustomerList {
  private readonly orders = inject(Orders);

  protected readonly rows = signal<CustomerSummary[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly countryName = COUNTRY_NAME;

  protected readonly shown = computed(() => {
    const q = this.search().trim().toLowerCase();
    const rows = this.rows() ?? [];
    if (!q) return rows;
    const digits = phoneDigits(q).replace(/^0+/, '');
    return rows.filter(
      (c) =>
        `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        (digits.length >= 4 && phoneDigits(c.phone).includes(digits)),
    );
  });

  constructor() {
    this.orders
      .customers()
      .then((r) => this.rows.set(r))
      .catch((e: Error) => this.error.set(e.message));
  }

  protected spent(c: CustomerSummary): string {
    return formatMoney(spent(c), 'EUR');
  }

  protected returned(c: CustomerSummary): number {
    return c.orders.filter((o) => o.status === 'returned' || o.status === 'delivery_failed').length;
  }
}
