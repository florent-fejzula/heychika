import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { COUNTRY_NAME, formatMoney } from '../../core/money';
import { OrderSummary, Orders, PAYMENT_LABEL, STAGES, STATUS_LABEL, Stage, phoneDigits, stageOf } from '../../core/orders';
import { OrdersTabs } from './orders-tabs';

/** The first stage with something in it is where the day's work starts. */
const WORK_ORDER: Stage[] = ['confirm', 'send', 'road', 'cash'];

@Component({
  selector: 'app-order-list',
  imports: [RouterLink, OrdersTabs],
  templateUrl: './order-list.html',
  styleUrl: './order-list.scss',
})
export class OrderList {
  private readonly orders = inject(Orders);
  private readonly router = inject(Router);

  /** ?stage=cash, so a tile on the Today page can link straight to a list. */
  readonly stageParam = input<string>(undefined, { alias: 'stage' });

  protected readonly rows = signal<OrderSummary[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');

  protected readonly label = STATUS_LABEL;
  protected readonly paymentLabel = PAYMENT_LABEL;
  protected readonly countryName = COUNTRY_NAME;

  protected readonly counts = computed(() => {
    const counts = Object.fromEntries(STAGES.map((s) => [s.stage, 0])) as Record<Stage, number>;
    for (const o of this.rows() ?? []) counts[stageOf(o)]++;
    return counts;
  });

  protected readonly stages = computed(() => STAGES.map((s) => ({ ...s, count: this.counts()[s.stage] })));

  protected readonly stage = linkedSignal<Stage>(() => {
    const asked = STAGES.find((s) => s.stage === this.stageParam())?.stage;
    return asked ?? WORK_ORDER.find((s) => this.counts()[s] > 0) ?? 'confirm';
  });

  /** Searching looks through every order, whatever its stage. */
  protected readonly shown = computed(() => {
    const rows = this.rows() ?? [];
    const q = this.search().trim().toLowerCase();
    if (!q) return rows.filter((o) => stageOf(o) === this.stage());
    const digits = phoneDigits(q);
    return rows.filter(
      (o) =>
        o.order_number.toLowerCase().includes(q) ||
        (o.delivery_name ?? '').toLowerCase().includes(q) ||
        (o.delivery_city ?? '').toLowerCase().includes(q) ||
        (digits.length >= 4 && phoneDigits(o.delivery_phone ?? '').includes(digits.replace(/^0+/, ''))),
    );
  });

  constructor() {
    this.orders
      .list()
      .then((r) => this.rows.set(r))
      .catch((e: Error) => this.error.set(e.message));
  }

  protected choose(stage: Stage): void {
    this.stage.set(stage);
    this.search.set('');
    this.router.navigate([], { queryParams: { stage }, replaceUrl: true });
  }

  protected items(o: OrderSummary): number {
    return o.lines.reduce((n, l) => n + l.qty, 0);
  }

  protected total(o: OrderSummary): string {
    return formatMoney(o.total_in_currency, o.currency);
  }

  protected when(o: OrderSummary): string {
    const d = new Date(o.created_at);
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  protected readonly stageOf = stageOf;
}
