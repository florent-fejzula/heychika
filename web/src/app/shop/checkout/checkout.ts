import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { COUNTRY_CURRENCY, COUNTRY_NAME, Country } from '../../core/money';
import { Bag } from '../bag';
import { BagContents, describe } from '../bag-contents';
import { CheckoutError, CheckoutProblem, CustomerDetails, ShopApi } from '../shop-api';
import { ShopState } from '../shop-state';
import { rememberOrder } from '../order/last-order';

const DETAILS_KEY = 'hc_details';

const PHONE_EXAMPLE: Record<Country, string> = { XK: '044 123 456', MK: '070 123 456', AL: '069 123 4567' };

/** Enough digits to be a real number; the database decides the rest. */
function phoneNumber(control: AbstractControl<string>): ValidationErrors | null {
  const digits = (control.value ?? '').replace(/\D/g, '').length;
  return !control.value || (digits >= 8 && digits <= 15) ? null : { phone: true };
}

type Field = 'first_name' | 'last_name' | 'phone' | 'city' | 'address' | 'postal_code' | 'notes';

const FIELD_ERROR: Record<Field, string> = {
  first_name: 'Enter your first name.',
  last_name: 'Enter your last name.',
  phone: 'Enter a phone number we can call, like ',
  city: 'Enter your town or city.',
  address: 'Enter the street and house number.',
  postal_code: 'That postcode looks too long.',
  notes: 'Keep the note under 500 characters.',
};

@Component({
  selector: 'app-checkout',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './checkout.html',
  styleUrl: './checkout.scss',
})
export class Checkout {
  private readonly api = inject(ShopApi);
  private readonly bag = inject(Bag);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly contents = inject(BagContents);
  protected readonly shop = inject(ShopState);

  protected readonly countries = (['XK', 'MK', 'AL'] as Country[]).map((code) => ({
    code,
    name: COUNTRY_NAME[code],
    currency: COUNTRY_CURRENCY[code],
  }));
  protected readonly countryName = computed(() => COUNTRY_NAME[this.shop.country()]);
  protected readonly phoneExample = computed(() => PHONE_EXAMPLE[this.shop.country()]);
  protected readonly days = computed(() => this.shop.zone()?.est_days ?? null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    first_name: ['', [Validators.required, Validators.maxLength(60)]],
    last_name: ['', [Validators.required, Validators.maxLength(60)]],
    phone: ['', [Validators.required, phoneNumber]],
    city: ['', [Validators.required, Validators.maxLength(80)]],
    address: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(200)]],
    postal_code: ['', Validators.maxLength(12)],
    notes: ['', Validators.maxLength(500)],
    // Left empty by people, filled in by form-filling bots. Hidden from both sight and screen readers.
    website: [''],
  });

  protected readonly submitted = signal(false);
  protected readonly placing = signal(false);
  protected readonly problem = signal<string | null>(null);

  constructor() {
    this.restoreDetails();
    this.contents.load();
  }

  protected chooseCountry(country: Country): void {
    this.shop.setCountry(country);
    this.problem.set(null);
  }

  protected showError(field: Field): boolean {
    const c = this.form.controls[field];
    return c.invalid && (this.submitted() || c.touched);
  }

  protected errorFor(field: Field): string {
    if (this.form.controls[field].hasError('server') && field === 'phone') {
      return `That number doesn’t look right for ${this.countryName()}. Try it like ${this.phoneExample()}.`;
    }
    return FIELD_ERROR[field] + (field === 'phone' ? `${this.phoneExample()}.` : '');
  }

  protected async place(): Promise<void> {
    this.submitted.set(true);
    this.problem.set(null);

    if (this.form.invalid) {
      this.focusFirstError();
      return;
    }
    const totals = this.contents.totals();
    const rows = this.contents.rows();
    if (!totals || !rows.length || this.placing()) return;
    if (this.form.controls.website.value) return; // a bot

    const v = this.form.getRawValue();
    const customer: CustomerDetails = {
      first_name: v.first_name.trim(),
      last_name: v.last_name.trim(),
      phone: v.phone.trim(),
      city: v.city.trim(),
      address: v.address.trim(),
      postal_code: v.postal_code.trim(),
    };

    this.placing.set(true);
    try {
      const placed = await this.api.placeOrder(
        this.shop.country(),
        customer,
        rows.map((r) => ({ variant_id: r.item.variantId, qty: r.qty })),
        v.notes.trim(),
        totals.total,
      );
      this.saveDetails(customer);
      rememberOrder({ number: placed.order_number, phone: customer.phone, name: customer.first_name });
      this.bag.clear();
      await this.router.navigate(['/order', placed.order_number]);
    } catch (e) {
      await this.explain(e instanceof CheckoutError ? e.problem : { kind: 'unknown' });
    } finally {
      this.placing.set(false);
    }
  }

  private async explain(problem: CheckoutProblem): Promise<void> {
    switch (problem.kind) {
      case 'sold_out':
      case 'not_available': {
        const item = this.contents.rows().find((r) => r.item.variantId === problem.variantId)?.item;
        await this.contents.load();
        this.problem.set(
          `${item ? describe(item) : 'Something in your bag'} sold out while you were ordering. ` +
            'Your bag has been updated. Check it and place the order again.',
        );
        break;
      }
      case 'price_changed':
        await this.contents.load();
        this.problem.set(
          `A price changed since you added it. The total is now ${this.shop.money(problem.total)}. Check it and place the order again.`,
        );
        break;
      case 'too_many_orders':
        this.problem.set(
          'You already have orders waiting for us to confirm. We’ll call you soon. If you need to change one, message us.',
        );
        break;
      case 'busy':
        this.problem.set(
          'We have a lot of orders waiting to be confirmed, so the shop has paused new ones for a little while. ' +
            'Send us a message and we’ll take your order there, or try again later.',
        );
        break;
      case 'invalid':
        if (problem.field in this.form.controls) {
          const control = this.form.controls[problem.field as Field];
          control.setErrors({ server: true });
          control.markAsTouched();
          this.focusFirstError();
          this.problem.set('Check the highlighted detail and try again.');
        } else {
          await this.contents.load();
          this.problem.set('Something in your bag couldn’t be ordered. Your bag has been refreshed; please try again.');
        }
        break;
      case 'offline':
        this.problem.set('Couldn’t reach the shop. Check your connection and try again.');
        break;
      default:
        this.problem.set('Something went wrong and the order wasn’t placed. Try again in a moment, or message us.');
    }
  }

  private focusFirstError(): void {
    queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>('.invalid input, .invalid textarea')?.focus());
  }

  // Remembered on this phone only, so a returning customer doesn't type it all again.
  private restoreDetails(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(DETAILS_KEY) ?? 'null');
      if (saved && typeof saved === 'object') {
        this.form.patchValue({
          first_name: String(saved.first_name ?? ''),
          last_name: String(saved.last_name ?? ''),
          phone: String(saved.phone ?? ''),
          city: String(saved.city ?? ''),
          address: String(saved.address ?? ''),
          postal_code: String(saved.postal_code ?? ''),
        });
      }
    } catch {
      // Nothing saved, or storage blocked.
    }
  }

  private saveDetails(details: CustomerDetails): void {
    try {
      localStorage.setItem(DETAILS_KEY, JSON.stringify(details));
    } catch {
      // Not remembered; no harm.
    }
  }
}
