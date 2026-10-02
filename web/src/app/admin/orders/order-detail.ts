import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { COUNTRY_NAME, formatMoney, parseAmount } from '../../core/money';
import { OrderDetail as Order, OrderLine, Orders, PAYMENT_LABEL, STATUS_LABEL, phoneDigits } from '../../core/orders';
import { soldQty, unitSaleEur } from '../../core/reports';

type Panel = 'cancel' | 'delivered' | 'failed' | 'cash' | 'edit' | null;

/** Quick reasons, so cancelling from a phone is two taps. */
export const CANCEL_REASONS = ['Customer changed her mind', 'Couldn’t reach the customer', 'Out of stock', 'Duplicate order'];

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
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly done = signal<string | null>(null);
  protected readonly copied = signal(false);
  protected readonly panel = signal<Panel>(null);

  protected readonly label = STATUS_LABEL;
  protected readonly paymentLabel = PAYMENT_LABEL;
  protected readonly countryName = COUNTRY_NAME;
  protected readonly cancelReasons = CANCEL_REASONS;

  // Panel inputs
  protected readonly reason = signal('');
  protected readonly note = signal('');
  protected readonly amount = signal('');
  protected readonly cashNow = signal(true);
  protected readonly refused = signal<Record<number, number>>({});
  protected readonly edit = signal<Record<string, string>>({});

  protected readonly digits = computed(() => phoneDigits(this.order()?.delivery_phone ?? ''));
  protected readonly previousOrders = computed(() => Math.max(0, (this.order()?.customer?.orders[0]?.count ?? 1) - 1));
  protected readonly items = computed(() => (this.order()?.lines ?? []).reduce((n, l) => n + l.qty, 0));
  protected readonly status = computed(() => this.order()?.status);

  protected readonly canEditDetails = computed(() => ['new', 'confirmed', 'dispatched', 'delivery_failed'].includes(this.status() ?? ''));
  protected readonly canChangeItems = computed(() => ['new', 'confirmed'].includes(this.status() ?? ''));
  protected readonly canReturn = computed(() => {
    const o = this.order();
    return !!o && ['dispatched', 'delivery_failed', 'delivered', 'completed', 'partially_returned'].includes(o.status)
      && o.lines.some((l) => l.returned_qty < l.qty);
  });
  protected readonly cashDue = computed(() => {
    const o = this.order();
    return !!o && o.payment_status === 'unpaid' && (o.status === 'delivered' || o.status === 'partially_returned');
  });

  /** What the courier should hand over: the total, less anything handed back or returned. */
  protected readonly expectedCash = computed(() => {
    const o = this.order();
    if (!o) return 0;
    const back = o.lines.reduce((sum, l) => sum + (l.returned_qty + l.refused_qty + (this.refused()[l.id] ?? 0)) * this.localPrice(l), 0);
    return Math.max(0, o.total_in_currency - back);
  });

  // Counted the way the sales report counts it, so the two agree: what the customer
  // kept, at the price they paid, less what it cost when it was sent.
  protected readonly cogs = computed(() => {
    const o = this.order();
    if (!o || o.lines.some((l) => l.unit_cost_eur === null)) return null;
    const cost = o.lines.reduce((sum, l) => sum + soldQty(l) * (l.unit_cost_eur ?? 0), 0);
    const sold = o.lines.reduce((sum, l) => sum + soldQty(l) * unitSaleEur(l, o.currency_per_eur), 0);
    return { cost, profit: sold - cost };
  });

  constructor() {
    effect(() => {
      const id = Number(this.id());
      untracked(() => this.load(id));
    });
  }

  // ---------------------------------------------------------------- display

  protected money(amount: number): string {
    return formatMoney(amount, this.order()?.currency ?? 'EUR');
  }

  protected eur(amount: number): string {
    return formatMoney(amount, 'EUR');
  }

  protected localPrice(l: OrderLine): number {
    const o = this.order();
    return l.unit_price_in_currency ?? (o ? l.unit_price_eur * o.currency_per_eur : l.unit_price_eur);
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  protected lineName(lineId: number): string {
    const l = this.order()?.lines.find((x) => x.id === lineId);
    return l ? `${l.product_name_snapshot} · ${l.color_snapshot} ${l.size_snapshot}` : 'Item';
  }

  // ---------------------------------------------------------------- panels

  protected open(panel: Panel): void {
    const o = this.order();
    this.error.set(null);
    this.done.set(null);
    this.reason.set('');
    this.note.set('');
    this.refused.set({});
    this.cashNow.set(true);
    if (panel === 'edit' && o) {
      this.edit.set({
        delivery_name: o.delivery_name ?? '',
        delivery_phone: o.delivery_phone ?? '',
        delivery_city: o.delivery_city ?? '',
        delivery_address: o.delivery_address ?? '',
        delivery_postal_code: o.delivery_postal_code ?? '',
        delivery_notes: o.delivery_notes ?? '',
      });
    }
    this.panel.set(this.panel() === panel ? null : panel);
    this.amount.set(String(this.expectedCash()));
  }

  protected refusedOf(line: OrderLine): number {
    return this.refused()[line.id] || 0;
  }

  protected setRefused(line: OrderLine, qty: number): void {
    const max = line.qty - line.returned_qty - line.refused_qty;
    this.refused.update((r) => ({ ...r, [line.id]: Math.max(0, Math.min(max, qty)) }));
    this.amount.set(String(this.expectedCash()));
  }

  protected setEdit(field: string, value: string): void {
    this.edit.update((e) => ({ ...e, [field]: value }));
  }

  // ---------------------------------------------------------------- actions

  protected confirm(): Promise<void> {
    return this.act(() => this.orders.confirm(this.order()!.id), 'Confirmed.');
  }

  protected cancel(): Promise<void> {
    const reason = this.reason().trim();
    if (!reason) {
      this.error.set('Choose or type a reason.');
      return Promise.resolve();
    }
    return this.act(() => this.orders.cancel(this.order()!.id, reason), 'Cancelled. The items are back on sale.');
  }

  protected delivered(): Promise<void> {
    const refused = Object.entries(this.refused())
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => ({ order_line_id: Number(id), qty }));
    let amount: number | null = null;
    if (this.cashNow()) {
      amount = parseAmount(this.amount());
      if (amount === null) {
        this.error.set('Enter the amount the courier collected, like 1550 or 27.50.');
        return Promise.resolve();
      }
    }
    return this.act(
      () => this.orders.markDelivered(this.order()!.id, refused, amount),
      amount !== null ? 'Delivered and paid.' : 'Delivered. Record the cash when it arrives.',
    );
  }

  protected cash(): Promise<void> {
    const amount = parseAmount(this.amount());
    if (amount === null) {
      this.error.set('Enter the amount received, like 1550 or 27.50.');
      return Promise.resolve();
    }
    return this.act(() => this.orders.recordPayment(this.order()!.id, amount), 'Cash recorded.');
  }

  protected failed(): Promise<void> {
    return this.act(() => this.orders.markFailed(this.order()!.id, this.note().trim()), 'Marked not delivered. The parcel still counts as on the road.');
  }

  protected retry(): Promise<void> {
    return this.act(() => this.orders.retry(this.order()!.id, ''), 'Back with the courier.');
  }

  protected saveDetails(): Promise<void> {
    const o = this.order()!;
    const e = this.edit();
    // Only what changed, so an unchanged phone isn't re-checked.
    const changed = Object.fromEntries(
      Object.entries(e).filter(([k, v]) => v.trim() !== ((o as unknown as Record<string, string | null>)[k] ?? '')),
    );
    if (!Object.keys(changed).length) {
      this.panel.set(null);
      return Promise.resolve();
    }
    return this.act(() => this.orders.updateDetails(o.id, changed), 'Saved.');
  }

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

  private async act(step: () => Promise<void>, success: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await step();
      this.panel.set(null);
      await this.load(this.order()!.id, false);
      this.done.set(success);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  private async load(id: number, showLoading = true): Promise<void> {
    if (showLoading) this.state.set('loading');
    try {
      const o = await this.orders.get(id);
      this.order.set(o);
      this.state.set(o ? 'ready' : 'missing');
    } catch (e) {
      this.loadError.set((e as Error).message);
      this.state.set('error');
    }
  }
}
