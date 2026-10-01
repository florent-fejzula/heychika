import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { COUNTRY_NAME, formatMoney } from '../../core/money';
import { OrderDetail as Order, Orders, STATUS_LABEL, phoneDigits } from '../../core/orders';

@Component({
  selector: 'app-order-detail',
  imports: [RouterLink],
  templateUrl: './order-detail.html',
  styleUrl: './order-detail.scss',
})
export class OrderDetail {
  private readonly orders = inject(Orders);

  /** From the route. */
  readonly id = input.required<string>();

  protected readonly order = signal<Order | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly error = signal<string | null>(null);
  protected readonly copied = signal(false);

  protected readonly label = STATUS_LABEL;
  protected readonly countryName = COUNTRY_NAME;

  protected readonly digits = computed(() => phoneDigits(this.order()?.delivery_phone ?? ''));
  protected readonly previousOrders = computed(() => Math.max(0, (this.order()?.customer?.orders[0]?.count ?? 1) - 1));
  protected readonly items = computed(() => (this.order()?.lines ?? []).reduce((n, l) => n + l.qty, 0));

  constructor() {
    effect(() => {
      const id = Number(this.id());
      this.state.set('loading');
      this.orders
        .get(id)
        .then((o) => {
          this.order.set(o);
          this.state.set(o ? 'ready' : 'missing');
        })
        .catch((e: Error) => {
          this.error.set(e.message);
          this.state.set('error');
        });
    });
  }

  protected money(amount: number): string {
    return formatMoney(amount, this.order()?.currency ?? 'EUR');
  }

  protected eur(amount: number): string {
    return formatMoney(amount, 'EUR');
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  /** Name, phone and address in one block, ready to paste into the courier's form or a DM. */
  protected async copyAddress(): Promise<void> {
    const o = this.order();
    if (!o) return;
    const text = [
      o.delivery_name,
      o.delivery_phone,
      o.delivery_address,
      [o.delivery_postal_code, o.delivery_city].filter(Boolean).join(' '),
      COUNTRY_NAME[o.country],
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // No clipboard permission: the details are on screen to copy by hand.
    }
  }
}
