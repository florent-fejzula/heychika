import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { COUNTRY_NAME, formatMoney } from '../../core/money';
import { OrderSummary, Orders, STATUS_LABEL } from '../../core/orders';

@Component({
  selector: 'app-order-list',
  imports: [RouterLink],
  templateUrl: './order-list.html',
  styleUrl: './order-list.scss',
})
export class OrderList {
  private readonly orders = inject(Orders);

  protected readonly rows = signal<OrderSummary[] | null>(null);
  protected readonly error = signal<string | null>(null);

  // New orders first, always shown (even empty, so "nothing waiting" is visible); the rest below.
  protected readonly sections = computed(() => {
    const rows = this.rows() ?? [];
    const earlier = rows.filter((o) => o.status !== 'new');
    return [
      { title: 'To confirm', counted: true, orders: rows.filter((o) => o.status === 'new') },
      ...(earlier.length ? [{ title: 'Earlier', counted: false, orders: earlier }] : []),
    ];
  });

  protected readonly label = STATUS_LABEL;
  protected readonly countryName = COUNTRY_NAME;

  constructor() {
    this.orders
      .list()
      .then((r) => this.rows.set(r))
      .catch((e: Error) => this.error.set(e.message));
  }

  protected items(o: OrderSummary): number {
    return o.lines.reduce((n, l) => n + l.qty, 0);
  }

  protected total(o: OrderSummary): string {
    return formatMoney(o.total_in_currency, o.currency);
  }

  protected when(o: OrderSummary): string {
    const d = new Date(o.created_at);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
}
