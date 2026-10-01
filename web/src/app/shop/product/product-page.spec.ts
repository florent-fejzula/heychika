import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { Bag } from '../bag';
import { ShopApi, ShopProduct, ShopVariant } from '../shop-api';
import { ShopState } from '../shop-state';
import { ProductPage } from './product-page';

const BLACK = { id: 1, name: 'Black', hex: '#111', sort_order: 10 };
const RED = { id: 2, name: 'Red', hex: '#c00', sort_order: 20 };
const S = { id: 1, label: 'S', sort_order: 20 };
const M = { id: 2, label: 'M', sort_order: 30 };
const L = { id: 3, label: 'L', sort_order: 40 };

function v(id: number, color: typeof BLACK, size: typeof S, available: number, price = 30): ShopVariant {
  return { id, price_eur: price, compare_at_price_eur: null, color, size, available };
}

// Black: S (2 left), M (sold out), L (9). Red: S only (3), and Red costs more.
const dress: ShopProduct = {
  id: 1, slug: 'wrap-dress-dr-001', name: 'Wrap dress', description: 'Soft satin.', material: 'Satin', featured: false,
  created_at: '2026-10-01', category: { id: 1, name: 'Dresses', sort_order: 10 },
  variants: [v(10, BLACK, S, 2), v(11, BLACK, M, 0), v(12, BLACK, L, 9), v(20, RED, S, 3, 35)],
  images: [
    { storage_path: 'cover.jpg', color_id: null, is_primary: true, sort_order: 0 },
    { storage_path: 'red.jpg', color_id: 2, is_primary: false, sort_order: 1 },
  ],
};

async function setup(product: ShopProduct | null = dress, colour?: string, ok = true) {
  localStorage.clear();
  document.cookie = 'hc_country=; Max-Age=0; Path=/';
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: ShopApi, useValue: { imageUrl: (p: string, t = false) => (t ? `t/${p}` : `f/${p}`) } }],
  });
  TestBed.inject(ShopState).context.set({
    settings: { store_name: 'Hey Chika', contact_phone: null, contact_email: null, instagram_url: null, tiktok_url: null, facebook_url: null, mkd_per_eur: 61.5, all_per_eur: 98, mkd_rounding: 50, all_rounding: 100 },
    zones: [{ country: 'XK', currency: 'EUR', fee_eur: 2, free_over_eur: null, est_days: '1–2 days' }, { country: 'MK', currency: 'MKD', fee_eur: 4, free_over_eur: null, est_days: null }],
    categories: [],
  });
  const fixture = TestBed.createComponent(ProductPage);
  fixture.componentRef.setInput('product', ok ? { ok: true, value: product } : { ok: false });
  if (colour) fixture.componentRef.setInput('colour', colour);
  await settle(fixture);
  return { fixture, el: fixture.nativeElement as HTMLElement, bag: TestBed.inject(Bag) };
}

async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
}

const sizeInput = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLLabelElement>('label.size')].find((l) => l.textContent!.trim().startsWith(label))!.querySelector('input')!;
const colourInput = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll<HTMLLabelElement>('label.colour')].find((l) => l.textContent!.includes(name))!.querySelector('input')!;
const buyButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.buy button')!;

async function pick(fixture: ComponentFixture<unknown>, input: HTMLInputElement) {
  input.click();
  await settle(fixture);
}

describe('ProductPage', () => {
  it('shows the design with its price in the customer’s currency', async () => {
    const { fixture, el } = await setup();
    expect(el.querySelector('h1')?.textContent).toBe('Wrap dress');
    expect(el.querySelector('.price')?.textContent).toContain('€30.00');

    TestBed.inject(ShopState).setCountry('MK');
    await settle(fixture);
    expect(el.querySelector('.price')?.textContent).toContain('1,850 MKD'); // 30 x 61.5 = 1845 -> 1850
  });

  it('starts on the first colour in stock and asks for a size before adding', async () => {
    const { el } = await setup();
    expect(colourInput(el, 'Black').checked).toBe(true);
    expect(buyButton(el).textContent).toContain('Choose a size');
    expect(buyButton(el).disabled).toBe(true);
  });

  it('opens on the colour a shared link names, with that colour’s photos', async () => {
    const { el } = await setup(dress, 'red');
    expect(colourInput(el, 'Red').checked).toBe(true);
    expect([...el.querySelectorAll('.gallery img')].map((i) => i.getAttribute('src'))).toEqual(['f/cover.jpg', 'f/red.jpg']);
    expect(el.querySelector('.price')?.textContent).toContain('€35.00');
  });

  it('crosses out sizes that are sold out or not made in the chosen colour', async () => {
    const { fixture, el } = await setup();
    expect(sizeInput(el, 'M').disabled).toBe(true); // Black M sold out
    expect(sizeInput(el, 'L').disabled).toBe(false);

    await pick(fixture, colourInput(el, 'Red'));
    expect(sizeInput(el, 'S').disabled).toBe(false);
    expect(sizeInput(el, 'L').disabled).toBe(true); // no Red L
  });

  it('adds the chosen size to the bag, and says when only a few are left', async () => {
    const { fixture, el, bag } = await setup();
    await pick(fixture, sizeInput(el, 'S'));
    expect(el.querySelector('.few')?.textContent).toContain('Only 2 left');

    buyButton(el).click();
    await settle(fixture);
    expect(bag.lines()).toEqual([{ variantId: 10, qty: 1 }]);
    expect(el.querySelector('.added')?.textContent).toContain('Added to your bag');
  });

  it('won’t put more in the bag than there are', async () => {
    const { fixture, el, bag } = await setup();
    await pick(fixture, sizeInput(el, 'S'));
    buyButton(el).click();
    await settle(fixture);
    buyButton(el).click();
    await settle(fixture);
    expect(bag.qtyOf(10)).toBe(2);
    expect(buyButton(el).disabled).toBe(true);
    expect(buyButton(el).textContent).toContain('All we have is in your bag');
  });

  it('keeps the size when switching to a colour that has it, and asks again when it doesn’t', async () => {
    const { fixture, el } = await setup();
    await pick(fixture, sizeInput(el, 'S'));
    await pick(fixture, colourInput(el, 'Red'));
    expect(sizeInput(el, 'S').checked).toBe(true);

    await pick(fixture, colourInput(el, 'Black'));
    await pick(fixture, sizeInput(el, 'L'));
    await pick(fixture, colourInput(el, 'Red'));
    expect(buyButton(el).textContent).toContain('Choose a size');
  });

  it('says what delivery costs and that payment is cash on delivery', async () => {
    const { el } = await setup();
    const text = el.querySelector('.delivery')?.textContent ?? '';
    expect(text).toContain('Delivery to Kosovo');
    expect(text).toContain('€2.00');
    expect(text).toContain('1–2 days');
    expect(text).toContain('cash');
  });

  it('sets the title and the link preview a DM shows', async () => {
    await setup();
    expect(TestBed.inject(Title).getTitle()).toBe('Wrap dress · Hey Chika');
    const meta = TestBed.inject(Meta);
    expect(meta.getTag("property='og:title'")?.content).toBe('Wrap dress');
    expect(meta.getTag("property='og:image'")?.content).toBe('f/cover.jpg');
    expect(meta.getTag("property='og:description'")?.content).toBe('Soft satin.');
  });

  it('says so when the design is no longer for sale', async () => {
    const { el } = await setup(null);
    expect(el.textContent).toContain('isn’t available any more');
    expect(el.querySelector('a[href="/"]')).toBeTruthy();
  });

  it('says so when the page couldn’t load', async () => {
    const { el } = await setup(null, undefined, false);
    expect(el.textContent).toContain('couldn’t load');
  });
});
