import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Bag } from '../bag';
import { BagItem, ShopApi } from '../shop-api';
import { ShopState } from '../shop-state';
import { BagPage } from './bag-page';

function item(variantId: number, name: string, priceEur: number, available: number): BagItem {
  return {
    variantId, priceEur, available,
    product: { slug: `p-${variantId}`, name }, color: { name: 'Black', hex: '#111' }, size: 'M', image: null,
  };
}

async function setup(lines: [number, number][], items: BagItem[], freeOver: number | null = null) {
  localStorage.clear();
  document.cookie = 'hc_country=; Max-Age=0; Path=/';
  localStorage.setItem('hc_bag', JSON.stringify(lines.map(([variantId, qty]) => ({ variantId, qty }))));
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: ShopApi, useValue: { bagItems: vi.fn().mockResolvedValue(items), imageUrl: (p: string) => p } }],
  });
  TestBed.inject(ShopState).context.set({
    settings: { store_name: 'Hey Chika', contact_phone: null, contact_email: null, instagram_url: null, tiktok_url: null, facebook_url: null, mkd_per_eur: 61.5, all_per_eur: 98, mkd_rounding: 50, all_rounding: 100 },
    zones: [{ country: 'XK', currency: 'EUR', fee_eur: 2, free_over_eur: freeOver, est_days: null }],
    categories: [],
  });
  const fixture = TestBed.createComponent(BagPage);
  await settle(fixture);
  return { fixture, el: fixture.nativeElement as HTMLElement, bag: TestBed.inject(Bag) };
}

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 3; i++) {
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }
}

const total = (el: HTMLElement) => el.querySelector('.total dd')?.textContent;

describe('BagPage', () => {
  it('lists what’s in the bag at today’s prices, with delivery and the total', async () => {
    const { el } = await setup([[10, 2]], [item(10, 'Wrap dress', 25, 4)]);
    expect(el.querySelector('.name')?.textContent).toBe('Wrap dress');
    expect(total(el)).toBe('€52.00');
  });

  it('changes quantities, up to what’s in stock', async () => {
    const { fixture, el, bag } = await setup([[10, 1]], [item(10, 'Wrap dress', 25, 2)]);
    const plus = el.querySelector<HTMLButtonElement>('[aria-label="One more"]')!;
    plus.click();
    await settle(fixture);
    expect(bag.qtyOf(10)).toBe(2);
    expect(plus.disabled).toBe(true);
    expect(total(el)).toBe('€52.00');

    el.querySelector<HTMLButtonElement>('.remove')!.click();
    await settle(fixture);
    expect(el.textContent).toContain('Your bag is empty');
  });

  it('takes out what sold out or came off sale, lowers what’s short, and says so', async () => {
    const { el, bag } = await setup(
      [[10, 3], [20, 1], [30, 1]],
      [item(10, 'Wrap dress', 25, 1), item(20, 'Silk top', 39, 0)], // 30 is no longer for sale
    );
    expect(bag.lines()).toEqual([{ variantId: 10, qty: 1 }]);
    const notes = [...el.querySelectorAll('.notice')].map((n) => n.textContent);
    expect(notes).toContain('Something in your bag is no longer for sale, so it’s been taken out.');
    expect(notes).toContain('Silk top (Black, M) has just sold out, so it’s been taken out of your bag.');
    expect(notes).toContain('Only 1 left of Wrap dress (Black, M). Your bag has been changed to 1.');
  });

  it('says how much more makes delivery free', async () => {
    const { el } = await setup([[10, 1]], [item(10, 'Wrap dress', 25, 4)], 50);
    expect(el.textContent).toContain('Add €25.00 more for free delivery');
  });
});
