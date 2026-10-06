import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '../../core/i18n';
import { formatMoney } from '../../core/money';
import { OrderStatus, ShopApi, TrackedOrder } from '../shop-api';
import { LastOrder, lastOrder } from './last-order';

// What each status means to the customer (translation keys). Steps are the
// normal journey; the rest replace the steps with a sentence.
const STEPS: { label: string; reached: OrderStatus[] }[] = [
  { label: 'shop.order.step.received', reached: ['new', 'confirmed', 'dispatched', 'delivered', 'completed'] },
  { label: 'shop.order.step.confirmed', reached: ['confirmed', 'dispatched', 'delivered', 'completed'] },
  { label: 'shop.order.step.onItsWay', reached: ['dispatched', 'delivered', 'completed'] },
  { label: 'shop.order.step.delivered', reached: ['delivered', 'completed'] },
];

const OFF_THE_PATH: Partial<Record<OrderStatus, string>> = {
  cancelled: 'shop.order.status.cancelled',
  delivery_failed: 'shop.order.status.deliveryFailed',
  returned: 'shop.order.status.returned',
  partially_returned: 'shop.order.status.partiallyReturned',
};

const NEXT: Partial<Record<OrderStatus, string>> = {
  new: 'shop.order.status.new',
  confirmed: 'shop.order.status.confirmed',
  dispatched: 'shop.order.status.dispatched',
};

@Component({
  selector: 'app-order-page',
  imports: [FormsModule, NgTemplateOutlet, RouterLink, TranslatePipe],
  templateUrl: './order-page.html',
  styleUrl: './order-page.scss',
})
export class OrderPage implements OnInit {
  private readonly api = inject(ShopApi);
  private readonly i18n = inject(I18n);

  /** From /order/:number. */
  readonly number = input<string>();

  protected readonly order = signal<TrackedOrder | null>(null);
  protected readonly justPlaced = signal<LastOrder | null>(null);
  protected readonly state = signal<'form' | 'loading' | 'shown' | 'not_found' | 'error'>('form');

  protected numberText = '';
  protected phoneText = '';

  protected readonly steps = computed(() => {
    const o = this.order();
    return o && !OFF_THE_PATH[o.status] ? STEPS.map((s) => ({ label: s.label, done: s.reached.includes(o.status) })) : null;
  });
  protected readonly sentence = computed(() => {
    const o = this.order();
    return o ? (OFF_THE_PATH[o.status] ?? NEXT[o.status] ?? null) : null;
  });
  protected readonly countryName = computed(() => {
    const o = this.order();
    return o ? this.i18n.t('common.country.' + o.country) : '';
  });

  ngOnInit(): void {
    const number = this.number();
    if (!number) return;
    this.numberText = number;

    // Straight from checkout in this tab: no need to ask for the phone again.
    const placed = lastOrder(number);
    if (placed) {
      this.justPlaced.set(placed);
      this.phoneText = placed.phone;
      this.look();
    }
  }

  protected money(amount: number): string {
    const o = this.order();
    return o ? formatMoney(amount, o.currency) : '';
  }

  protected date(iso: string): string {
    return this.i18n.date(iso, { day: 'numeric', month: 'long' });
  }

  protected async look(): Promise<void> {
    const number = this.numberText.trim();
    const phone = this.phoneText.trim();
    if (!number || !phone) return;

    this.state.set('loading');
    try {
      const order = await this.api.trackOrder(number, phone);
      this.order.set(order);
      this.state.set(order ? 'shown' : 'not_found');
    } catch {
      this.state.set('error');
    }
  }
}
