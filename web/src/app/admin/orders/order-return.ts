import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { formatMoney, parseAmount } from '../../core/money';
import { OrderDetail, OrderLine, Orders, ReturnCondition } from '../../core/orders';

interface Back {
  qty: number;
  condition: ReturnCondition;
}

export const RETURN_REASONS = ['Refused at the door', 'Couldn’t be delivered', 'Wrong size', 'Didn’t like it', 'Faulty or damaged'];

/**
 * Something came back. Each item is looked at and recorded as fit to sell again (back
 * on the shelf) or damaged (set aside). Money goes back only if it was paid.
 */
@Component({
  selector: 'app-order-return',
  imports: [RouterLink],
  templateUrl: './order-return.html',
  styleUrl: './order-return.scss',
})
export class OrderReturn {
  private readonly orders = inject(Orders);
  private readonly router = inject(Router);

  readonly id = input.required<string>();

  protected readonly order = signal<OrderDetail | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly loadError = signal<string | null>(null);
  protected readonly back = signal<Record<number, Back>>({});
  protected readonly reason = signal('');
  protected readonly refund = signal('');
  protected readonly method = signal('cash');
  protected readonly notes = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly reasons = RETURN_REASONS;

  /** Lines with something still out. */
  protected readonly open = computed(() => (this.order()?.lines ?? []).filter((l) => l.returned_qty < l.qty));
  protected readonly paid = computed(() => {
    const o = this.order();
    return !!o && o.payment_status !== 'unpaid';
  });
  protected readonly undelivered = computed(() => ['dispatched', 'delivery_failed'].includes(this.order()?.status ?? ''));
  protected readonly canReturn = computed(() =>
    ['dispatched', 'delivery_failed', 'delivered', 'completed', 'partially_returned'].includes(this.order()?.status ?? '') && this.open().length > 0);

  protected readonly count = computed(() => Object.values(this.back()).reduce((n, b) => n + b.qty, 0));
  /** The value of what's coming back, at the prices on the order: a starting point for the refund. */
  protected readonly value = computed(() => {
    const o = this.order();
    if (!o) return 0;
    return o.lines.reduce((sum, l) => sum + (this.back()[l.id]?.qty ?? 0) * (l.unit_price_in_currency ?? l.unit_price_eur * o.currency_per_eur), 0);
  });

  constructor() {
    effect(() => {
      const id = Number(this.id());
      untracked(() => this.load(id));
    });
  }

  protected backOf(line: OrderLine): Back {
    return this.back()[line.id] ?? { qty: 0, condition: 'saleable' };
  }

  protected setQty(line: OrderLine, qty: number): void {
    const max = line.qty - line.returned_qty;
    this.back.update((b) => ({ ...b, [line.id]: { ...this.backOf(line), qty: Math.max(0, Math.min(max, qty)) } }));
    if (this.paid()) this.refund.set(String(this.value()));
  }

  protected setCondition(line: OrderLine, condition: ReturnCondition): void {
    this.back.update((b) => ({ ...b, [line.id]: { ...this.backOf(line), condition } }));
  }

  protected money(amount: number): string {
    return formatMoney(amount, this.order()?.currency ?? 'EUR');
  }

  protected async save(): Promise<void> {
    const o = this.order();
    if (!o || this.busy()) return;
    const lines = Object.entries(this.back())
      .filter(([, b]) => b.qty > 0)
      .map(([id, b]) => ({ order_line_id: Number(id), qty: b.qty, condition: b.condition }));
    if (!lines.length) {
      this.error.set('Choose what came back.');
      return;
    }
    if (!this.reason().trim()) {
      this.error.set('Say why it came back.');
      return;
    }
    let refund = 0;
    if (this.paid() && this.refund().trim()) {
      const parsed = parseAmount(this.refund());
      if (parsed === null) {
        this.error.set('Enter the refund as a number, like 1550 or 25.50, or 0 for none.');
        return;
      }
      refund = parsed;
    }

    this.busy.set(true);
    this.error.set(null);
    try {
      await this.orders.recordReturn(o.id, lines, this.reason().trim(), refund, refund > 0 ? this.method() : '', this.notes().trim());
      await this.router.navigate(['/admin/orders', o.id]);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  private async load(id: number): Promise<void> {
    this.state.set('loading');
    try {
      const o = await this.orders.get(id);
      this.order.set(o);
      this.state.set(o ? 'ready' : 'missing');
      if (!o) return;

      // A parcel that never got there comes back whole; otherwise start from what was handed back at the door.
      const undelivered = ['dispatched', 'delivery_failed'].includes(o.status);
      const start: Record<number, Back> = {};
      for (const l of o.lines) {
        const qty = undelivered ? l.qty - l.returned_qty : l.refused_qty;
        if (qty > 0) start[l.id] = { qty, condition: 'saleable' };
      }
      this.back.set(start);
      this.reason.set(undelivered ? (o.status === 'delivery_failed' ? 'Couldn’t be delivered' : 'Refused at the door')
        : o.lines.some((l) => l.refused_qty > 0) ? 'Refused at the door' : '');
      this.refund.set(this.paid() && !o.lines.some((l) => l.refused_qty > 0) ? String(this.value()) : '0');
    } catch (e) {
      this.loadError.set((e as Error).message);
      this.state.set('error');
    }
  }
}
