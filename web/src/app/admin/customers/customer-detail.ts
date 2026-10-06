import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '../../core/i18n';
import { COUNTRY_NAME, formatMoney } from '../../core/money';
import { CustomerDetail as Detail, Orders, STATUS_LABEL, phoneDigits } from '../../core/orders';
import { spent } from './customer-list';

type Field = 'first_name' | 'last_name' | 'phone' | 'city' | 'address' | 'postal_code' | 'email' | 'notes';

@Component({
  selector: 'app-customer-detail',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './customer-detail.html',
  styleUrl: './customer-detail.scss',
})
export class CustomerDetail {
  private readonly orders = inject(Orders);
  private readonly i18n = inject(I18n);

  readonly id = input.required<string>();

  protected readonly customer = signal<Detail | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly loadError = signal<string | null>(null);
  protected readonly editing = signal(false);
  protected readonly form = signal<Record<Field, string>>({ first_name: '', last_name: '', phone: '', city: '', address: '', postal_code: '', email: '', notes: '' });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly saved = signal(false);

  protected readonly label = STATUS_LABEL;
  protected readonly countryName = COUNTRY_NAME;

  protected readonly digits = computed(() => phoneDigits(this.customer()?.phone ?? ''));
  protected readonly totals = computed(() => {
    const c = this.customer();
    if (!c) return null;
    return {
      orders: c.orders.length,
      spent: formatMoney(spent(c), 'EUR'),
      notDelivered: c.orders.filter((o) => o.status === 'returned' || o.status === 'delivery_failed').length,
    };
  });

  constructor() {
    effect(() => {
      const id = Number(this.id());
      untracked(() => this.load(id));
    });
  }

  protected edit(): void {
    const c = this.customer()!;
    this.form.set({
      first_name: c.first_name, last_name: c.last_name, phone: c.phone, city: c.city, address: c.address,
      postal_code: c.postal_code ?? '', email: c.email ?? '', notes: c.notes ?? '',
    });
    this.error.set(null);
    this.saved.set(false);
    this.editing.set(true);
  }

  protected set(field: Field, value: string): void {
    this.form.update((f) => ({ ...f, [field]: value }));
  }

  protected async save(): Promise<void> {
    const f = this.form();
    if (!f.first_name.trim() || !f.city.trim() || !f.address.trim()) {
      this.error.set(this.i18n.t('admin.customers.needed'));
      return;
    }
    if (phoneDigits(f.phone).length < 8) {
      this.error.set(this.i18n.t('admin.customers.phoneShort'));
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const blank = (v: string) => (v.trim() ? v.trim() : null);
      await this.orders.updateCustomer(this.customer()!.id, {
        first_name: f.first_name.trim(), last_name: f.last_name.trim(), phone: f.phone.trim(), city: f.city.trim(),
        address: f.address.trim(), postal_code: blank(f.postal_code), email: blank(f.email), notes: blank(f.notes),
      });
      await this.load(this.customer()!.id, false);
      this.editing.set(false);
      this.saved.set(true);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected money(amount: number, currency: Detail['orders'][number]['currency']): string {
    return formatMoney(amount, currency);
  }

  protected date(iso: string): string {
    return this.i18n.date(iso, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  private async load(id: number, showLoading = true): Promise<void> {
    if (showLoading) this.state.set('loading');
    try {
      const c = await this.orders.customer(id);
      this.customer.set(c);
      this.state.set(c ? 'ready' : 'missing');
    } catch (e) {
      this.loadError.set((e as Error).message);
      this.state.set('error');
    }
  }
}
