import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { OrderDetail, OrderLine, Orders } from '../../core/orders';
import { Scanner } from '../shared/scanner';

const COURIER_KEY = 'hc_last_courier';

type Feedback = { kind: 'ok' | 'warn' | 'wrong'; text: string };

/**
 * Packing an order: scan each item as it goes into the parcel. The wrong size or
 * colour is caught here, before it crosses a border to a customer who'll refuse it.
 * When everything is ticked off, the order is sent and the stock moves with it.
 */
@Component({
  selector: 'app-order-pack',
  imports: [RouterLink, Scanner],
  templateUrl: './order-pack.html',
  styleUrl: './order-pack.scss',
})
export class OrderPack {
  private readonly orders = inject(Orders);
  private readonly router = inject(Router);

  readonly id = input.required<string>();

  protected readonly order = signal<OrderDetail | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly loadError = signal<string | null>(null);
  /** Items ticked off so far, per order line. */
  protected readonly packed = signal<Record<number, number>>({});
  protected readonly feedback = signal<Feedback | null>(null);
  protected readonly courier = signal(this.lastCourier());
  protected readonly tracking = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly skipCheck = signal(false);

  protected readonly canPack = computed(() => ['new', 'confirmed'].includes(this.order()?.status ?? ''));
  protected readonly total = computed(() => (this.order()?.lines ?? []).reduce((n, l) => n + l.qty, 0));
  protected readonly done = computed(() => (this.order()?.lines ?? []).reduce((n, l) => n + Math.min(l.qty, this.packedOf(l)), 0));
  protected readonly allPacked = computed(() => this.total() > 0 && this.done() === this.total());

  constructor() {
    effect(() => {
      const id = Number(this.id());
      untracked(() => this.load(id));
    });
  }

  protected packedOf(line: OrderLine): number {
    return this.packed()[line.id] || 0;
  }

  protected onScan(raw: string): void {
    const code = raw.trim().toUpperCase();
    const lines = this.order()?.lines ?? [];
    const line = lines.find((l) => l.variant?.barcode.toUpperCase() === code || l.sku_snapshot.toUpperCase() === code);

    if (!line) {
      navigator.vibrate?.([80, 60, 80, 60, 80]);
      this.feedback.set({ kind: 'wrong', text: `${raw.trim()} is not in this order. Put it back.` });
      return;
    }
    if (this.packedOf(line) >= line.qty) {
      this.feedback.set({ kind: 'warn', text: `Already have ${line.qty === 1 ? 'this one' : `all ${line.qty}`} of ${this.name(line)}.` });
      return;
    }
    this.tick(line);
  }

  /** For an item whose sticker won't scan: tick it by eye. */
  protected tick(line: OrderLine): void {
    if (this.packedOf(line) >= line.qty) return;
    const now = this.packedOf(line) + 1;
    this.packed.update((p) => ({ ...p, [line.id]: now }));
    this.feedback.set({ kind: 'ok', text: `${this.name(line)}${line.qty > 1 ? ` (${now} of ${line.qty})` : ''}` });
  }

  protected untick(line: OrderLine): void {
    this.packed.update((p) => ({ ...p, [line.id]: Math.max(0, this.packedOf(line) - 1) }));
  }

  protected async send(): Promise<void> {
    const o = this.order();
    if (!o || this.busy() || (!this.allPacked() && !this.skipCheck())) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.orders.dispatch(o.id, this.courier().trim(), this.tracking().trim());
      try {
        if (this.courier().trim()) localStorage.setItem(COURIER_KEY, this.courier().trim());
      } catch {
        // Not remembered; no harm.
      }
      await this.router.navigate(['/admin/orders', o.id]);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  private name(line: OrderLine): string {
    return `${line.product_name_snapshot}, ${line.color_snapshot} ${line.size_snapshot}`;
  }

  private lastCourier(): string {
    try {
      return localStorage.getItem(COURIER_KEY) ?? '';
    } catch {
      return '';
    }
  }

  private async load(id: number): Promise<void> {
    this.state.set('loading');
    try {
      const o = await this.orders.get(id);
      this.order.set(o);
      this.packed.set({});
      this.state.set(o ? 'ready' : 'missing');
    } catch (e) {
      this.loadError.set((e as Error).message);
      this.state.set('error');
    }
  }
}
