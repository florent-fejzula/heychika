import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Bag } from '../bag';
import { BagItem, CheckoutError, ShopApi } from '../shop-api';
import { ShopState } from '../shop-state';
import { Checkout } from './checkout';

function item(variantId: number, name: string, priceEur: number, available: number): BagItem {
  return {
    variantId, priceEur, available,
    product: { slug: `p-${variantId}`, name }, color: { name: 'Black', hex: '#111' }, size: 'M', image: null,
  };
}

const wrap = item(10, 'Wrap dress', 25, 3);
const top = item(20, 'Silk top', 39, 1);

async function setup(bagLines: [number, number][] = [[10, 2], [20, 1]], items: BagItem[] = [wrap, top], savedDetails: string | null = null) {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = 'hc_country=; Max-Age=0; Path=/';
  localStorage.setItem('hc_bag', JSON.stringify(bagLines.map(([variantId, qty]) => ({ variantId, qty }))));
  if (savedDetails) localStorage.setItem('hc_details', savedDetails);

  const api = {
    bagItems: vi.fn().mockResolvedValue(items),
    placeOrder: vi.fn().mockResolvedValue({ order_number: 'HC-2026-0001', currency: 'EUR', total_in_currency: 91 }),
    imageUrl: (p: string) => p,
  };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: ShopApi, useValue: api }] });
  TestBed.inject(ShopState).context.set({
    settings: { store_name: 'Hey Chika', contact_phone: null, contact_email: null, instagram_url: null, tiktok_url: null, facebook_url: null, mkd_per_eur: 61.5, all_per_eur: 98, mkd_rounding: 50, all_rounding: 100 },
    zones: [
      { country: 'XK', currency: 'EUR', fee_eur: 2, free_over_eur: null, est_days: '1–2 days' },
      { country: 'MK', currency: 'MKD', fee_eur: 4, free_over_eur: null, est_days: '2–4 days' },
      { country: 'AL', currency: 'ALL', fee_eur: 4, free_over_eur: null, est_days: '2–4 days' },
    ],
    categories: [],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(Checkout);
  await settle(fixture);
  return { fixture, api, navigate, el: fixture.nativeElement as HTMLElement, bag: TestBed.inject(Bag) };
}

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 3; i++) {
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }
}

function fill(el: HTMLElement, name: string, value: string) {
  const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[formControlName="${name}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('blur'));
}

function fillAll(el: HTMLElement) {
  fill(el, 'first_name', 'Arta');
  fill(el, 'last_name', 'Krasniqi');
  fill(el, 'phone', '044 123 456');
  fill(el, 'city', 'Prishtina');
  fill(el, 'address', 'Rr. Agim Ramadani 1');
}

async function place(fixture: ComponentFixture<unknown>, el: HTMLElement) {
  el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
  await settle(fixture);
}

const total = (el: HTMLElement) => el.querySelector('.total dd')?.textContent;

describe('Checkout', () => {
  it('shows the bag and the total to pay on delivery', async () => {
    const { el } = await setup();
    expect(el.querySelectorAll('.items li').length).toBe(2);
    expect(total(el)).toBe('€91.00'); // 2 x 25 + 39 + 2 delivery
    expect(el.querySelector('.fine')?.textContent).toContain('in cash when it arrives');
  });

  it('switches currency and delivery fee with the country', async () => {
    const { fixture, el } = await setup();
    const mk = [...el.querySelectorAll<HTMLLabelElement>('label.country')].find((l) => l.textContent!.includes('North Macedonia'))!;
    mk.querySelector('input')!.click();
    await settle(fixture);
    // 1550 x 2 + 2400 + 250 delivery
    expect(total(el)).toBe('5,750 MKD');
    expect(TestBed.inject(ShopState).country()).toBe('MK');
  });

  it('asks for what’s missing, and sends nothing', async () => {
    const { fixture, el, api } = await setup();
    fill(el, 'first_name', 'Arta');
    fill(el, 'phone', '123');
    await place(fixture, el);
    expect(api.placeOrder).not.toHaveBeenCalled();
    const errors = [...el.querySelectorAll('.error')].map((e) => e.textContent);
    expect(errors).toContain('Enter your last name.');
    expect(errors.some((e) => e!.includes('phone number we can call'))).toBe(true);
    expect(errors).toContain('Enter the street and house number.');
  });

  it('places the order with ids and quantities only, then empties the bag and shows the confirmation', async () => {
    const { fixture, el, api, navigate, bag } = await setup();
    fillAll(el);
    fill(el, 'notes', 'call after 5');
    await place(fixture, el);

    expect(api.placeOrder).toHaveBeenCalledWith(
      'XK',
      { first_name: 'Arta', last_name: 'Krasniqi', phone: '044 123 456', city: 'Prishtina', address: 'Rr. Agim Ramadani 1', postal_code: '' },
      [{ variant_id: 10, qty: 2 }, { variant_id: 20, qty: 1 }],
      'call after 5',
      91,
    );
    expect(bag.count()).toBe(0);
    expect(navigate).toHaveBeenCalledWith(['/order', 'HC-2026-0001']);
    expect(JSON.parse(sessionStorage.getItem('hc_last_order')!)).toEqual({ number: 'HC-2026-0001', phone: '044 123 456', name: 'Arta' });
  });

  it('remembers her details on this phone for next time', async () => {
    const first = await setup();
    fillAll(first.el);
    await place(first.fixture, first.el);
    const saved = localStorage.getItem('hc_details');

    TestBed.resetTestingModule();
    const { el } = await setup(undefined, undefined, saved);
    expect(el.querySelector<HTMLInputElement>('[formControlName="phone"]')!.value).toBe('044 123 456');
    expect(el.querySelector<HTMLInputElement>('[formControlName="address"]')!.value).toBe('Rr. Agim Ramadani 1');
  });

  it('when something sells out mid-order, updates the bag and says what happened', async () => {
    const { fixture, el, api, bag } = await setup();
    api.placeOrder.mockRejectedValueOnce(new CheckoutError({ kind: 'sold_out', variantId: 20, available: 0 }));
    api.bagItems.mockResolvedValue([wrap, { ...top, available: 0 }]);
    fillAll(el);
    await place(fixture, el);

    expect(el.querySelector('[role=alert]')?.textContent).toContain('Silk top (Black, M) sold out while you were ordering');
    expect(bag.lines()).toEqual([{ variantId: 10, qty: 2 }]);
    expect(total(el)).toBe('€52.00');
  });

  it('when a price changed, shows the new total and lets her place it again', async () => {
    const { fixture, el, api } = await setup();
    api.placeOrder.mockRejectedValueOnce(new CheckoutError({ kind: 'price_changed', total: 95 }));
    api.bagItems.mockResolvedValue([{ ...wrap, priceEur: 27 }, top]);
    fillAll(el);
    await place(fixture, el);
    expect(el.querySelector('[role=alert]')?.textContent).toContain('The total is now €95.00');
    expect(total(el)).toBe('€95.00');

    await place(fixture, el);
    expect(api.placeOrder).toHaveBeenLastCalledWith('XK', expect.anything(), expect.anything(), '', 95);
  });

  it('points at the detail the database didn’t accept', async () => {
    const { fixture, el, api } = await setup();
    api.placeOrder.mockRejectedValueOnce(new CheckoutError({ kind: 'invalid', field: 'phone' }));
    fillAll(el);
    await place(fixture, el);
    expect(el.querySelector('.field.invalid input')?.getAttribute('formControlName')).toBe('phone');
    expect(el.querySelector('.error')?.textContent).toContain('doesn’t look right for Kosovo');
  });

  it('says plainly when the shop can’t be reached', async () => {
    const { fixture, el, api, bag } = await setup();
    api.placeOrder.mockRejectedValueOnce(new CheckoutError({ kind: 'offline' }));
    fillAll(el);
    await place(fixture, el);
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Couldn’t reach the shop');
    expect(bag.count()).toBe(3); // nothing lost
  });

  it('ignores a submission from a bot that filled the hidden field', async () => {
    const { fixture, el, api } = await setup();
    fillAll(el);
    fill(el, 'website', 'http://spam.example');
    await place(fixture, el);
    expect(api.placeOrder).not.toHaveBeenCalled();
  });

  it('with an empty bag, sends her back to the shop', async () => {
    const { el } = await setup([], []);
    expect(el.textContent).toContain('Your bag is empty');
    expect(el.querySelector('form')).toBeNull();
  });
});
