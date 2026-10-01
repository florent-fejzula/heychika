import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { COUNTRY_NAME, formatMoney } from '../../core/money';
import { OrderStatus, ShopApi, TrackedOrder } from '../shop-api';
import { LastOrder, lastOrder } from './last-order';

// What each status means to the customer. Steps are the normal journey; the
// rest replace the steps with a sentence.
const STEPS: { label: string; reached: OrderStatus[] }[] = [
  { label: 'Received', reached: ['new', 'confirmed', 'dispatched', 'delivered', 'completed'] },
  { label: 'Confirmed', reached: ['confirmed', 'dispatched', 'delivered', 'completed'] },
  { label: 'On its way', reached: ['dispatched', 'delivered', 'completed'] },
  { label: 'Delivered', reached: ['delivered', 'completed'] },
];

const OFF_THE_PATH: Partial<Record<OrderStatus, string>> = {
  cancelled: 'This order was cancelled.',
  delivery_failed: 'The courier couldn’t deliver this order. We’ll be in touch.',
  returned: 'This order was returned.',
  partially_returned: 'Part of this order was returned.',
};

const NEXT: Partial<Record<OrderStatus, string>> = {
  new: 'We’ll call you to confirm, then send it.',
  confirmed: 'Confirmed. We’re packing it.',
  dispatched: 'It’s with the courier. They’ll call when they’re close.',
};

@Component({
  selector: 'app-order-page',
  imports: [FormsModule, NgTemplateOutlet, RouterLink],
  templateUrl: './order-page.html',
  styleUrl: './order-page.scss',
})
export class OrderPage implements OnInit {
  private readonly api = inject(ShopApi);

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
    return o ? COUNTRY_NAME[o.country] : '';
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
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
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
