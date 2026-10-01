import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ShopApi, ShopProduct, ShopVariant } from '../shop-api';
import { ShopState } from '../shop-state';
import { Home } from './home';

const BLACK = { id: 1, name: 'Black', hex: '#111', sort_order: 10 };
const RED = { id: 2, name: 'Red', hex: '#c00', sort_order: 20 };
const S = { id: 1, label: 'S', sort_order: 20 };
const M = { id: 2, label: 'M', sort_order: 30 };

function v(id: number, color: typeof BLACK, size: typeof S, available: number, price = 30, was: number | null = null): ShopVariant {
  return { id, price_eur: price, compare_at_price_eur: was, color, size, available };
}

function design(id: number, name: string, category: { id: number; name: string }, variants: ShopVariant[], featured = false): ShopProduct {
  return {
    id, slug: `p-${id}`, name, description: null, material: null, featured, created_at: '2026-10-01',
    category: { ...category, sort_order: id }, variants,
    images: [{ storage_path: `${id}.jpg`, color_id: null, is_primary: true, sort_order: 0 }],
  };
}

const DRESSES = { id: 1, name: 'Dresses' };
const TOPS = { id: 2, name: 'Tops' };

// Newest first, as the database returns them.
const products = [
  design(1, 'Sold-out dress', DRESSES, [v(1, BLACK, S, 0)]),
  design(2, 'Red top', TOPS, [v(2, RED, M, 4, 20, 28)]),
  design(3, 'Wrap dress', DRESSES, [v(3, BLACK, S, 1, 30), v(4, RED, M, 0, 35)]),
  design(4, 'Star dress', DRESSES, [v(5, BLACK, M, 3)], true),
];

async function setup(query: { category?: string; size?: string; colour?: string } = {}, list: ShopProduct[] = products) {
  document.cookie = 'hc_country=; Max-Age=0; Path=/';
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: ShopApi, useValue: { imageUrl: (p: string) => p } }],
  });
  TestBed.inject(ShopState).context.set({
    settings: { store_name: 'Hey Chika', contact_phone: null, contact_email: null, instagram_url: null, tiktok_url: null, facebook_url: null, mkd_per_eur: 61.5, all_per_eur: 98, mkd_rounding: 50, all_rounding: 100 },
    zones: [],
    categories: [{ id: 1, name: 'Dresses', slug: 'dresses' }, { id: 2, name: 'Tops', slug: 'tops' }, { id: 3, name: 'Jeans', slug: 'jeans' }],
  });
  const fixture = TestBed.createComponent(Home);
  fixture.componentRef.setInput('products', { ok: true, value: list });
  for (const [k, value] of Object.entries(query)) fixture.componentRef.setInput(k, value);
  await settle(fixture);
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable();
  fixture.detectChanges();
}

const names = (el: HTMLElement) => [...el.querySelectorAll('.grid .name')].map((n) => n.textContent);

describe('Home', () => {
  it('shows what’s in stock first, featured first among those, sold-out last', async () => {
    const { el } = await setup();
    expect(names(el)).toEqual(['Star dress', 'Red top', 'Wrap dress', 'Sold-out dress']);
    expect(el.querySelector('.grid li:last-child .flag')?.textContent).toBe('Sold out');
  });

  it('offers only the categories that have something in them', async () => {
    const { el } = await setup();
    expect([...el.querySelectorAll('.categories a')].map((a) => a.textContent)).toEqual(['All', 'Dresses', 'Tops']);
  });

  it('filters by category from the link', async () => {
    const { el } = await setup({ category: 'tops' });
    expect(names(el)).toEqual(['Red top']);
    expect(el.querySelector('.categories a.on')?.textContent).toBe('Tops');
  });

  it('a size or colour filter shows only what can be bought in it, and links to that colour', async () => {
    const { el } = await setup({ colour: 'red' });
    expect(names(el)).toEqual(['Red top']); // the red wrap dress is sold out
    expect(el.querySelector('.grid a')?.getAttribute('href')).toBe('/p/p-2?colour=red');

    TestBed.resetTestingModule();
    const sized = await setup({ size: 'S' });
    expect(names(sized.el)).toEqual(['Wrap dress']);
  });

  it('shows a sale price next to the old one, and "from" when sizes are priced differently', async () => {
    const { el } = await setup();
    const top = [...el.querySelectorAll('.grid li')].find((li) => li.textContent!.includes('Red top'))!;
    expect(top.querySelector('.price strong')?.textContent).toBe('€20.00');
    expect(top.querySelector('.price s')?.textContent).toBe('€28.00');
    expect(top.querySelector('.flag')?.textContent).toBe('Sale');

    TestBed.resetTestingModule();
    const both = await setup({}, [design(9, 'Two prices', DRESSES, [v(1, BLACK, S, 1, 30), v(2, BLACK, M, 1, 35)])]);
    expect(both.el.querySelector('.price')?.textContent).toContain('from');
  });

  it('says new pieces are coming when there is nothing at all', async () => {
    const { el } = await setup({}, []);
    expect(el.textContent).toContain('New pieces are on their way');
  });

  it('says so when nothing matches a filter, with a way back', async () => {
    const { el } = await setup({ category: 'dresses', size: 'M', colour: 'red' });
    expect(el.textContent).toContain('Nothing in stock matches');
    expect(el.querySelector('.message a')?.getAttribute('href')).toBe('/?category=dresses');
  });
});
