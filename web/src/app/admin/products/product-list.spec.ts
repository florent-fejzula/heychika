import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Catalogue, ProductStatus, ProductSummary } from '../../core/catalogue';
import { thumbPath } from '../../core/images';
import { ProductList } from './product-list';

function product(id: number, name: string, status: ProductStatus, extra: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id, name, status, model_code: String(id).padStart(3, '0'), show_online: true, featured: false,
    category: { code: 'DR', name: 'Dresses' },
    variants: [{ id: id * 10, price_eur: 30, active: true, stock: { qty_physical: 4, qty_available: 4 } }],
    images: [], ...extra,
  };
}

async function setup(products: ProductSummary[] | Error) {
  const stub = {
    listProducts: products instanceof Error ? vi.fn().mockRejectedValue(products) : vi.fn().mockResolvedValue(products),
    imageUrl: (p: string, thumb = false) => `https://files.test/${thumb ? thumbPath(p) : p}`,
  };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Catalogue, useValue: stub }] });
  const fixture = TestBed.createComponent(ProductList);
  await settle(fixture);
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable();
  await Promise.resolve();
  fixture.detectChanges();
  await fixture.whenStable();
}

const names = (el: HTMLElement) => [...el.querySelectorAll('.item strong')].map((s) => s.textContent!.trim());

describe('ProductList', () => {
  const data = [
    product(1, 'Black wrap dress', 'active'),
    product(2, 'Blue jeans', 'draft', { category: { code: 'JN', name: 'Jeans' } }),
    product(3, 'Old coat', 'archived'),
  ];

  it('hides archived designs by default', async () => {
    const { el } = await setup(data);
    expect(names(el)).toEqual(['Black wrap dress', 'Blue jeans']);
  });

  it('searches by name, by code and by category', async () => {
    const { fixture, el } = await setup(data);
    const search = el.querySelector<HTMLInputElement>('input[type=search]')!;
    for (const [query, expected] of [['jeans', ['Blue jeans']], ['dr-001', ['Black wrap dress']], ['dresses', ['Black wrap dress']]] as const) {
      search.value = query;
      search.dispatchEvent(new Event('input'));
      await settle(fixture);
      expect(names(el)).toEqual([...expected]);
    }
  });

  it('can show archived designs when asked', async () => {
    const { fixture, el } = await setup(data);
    const status = el.querySelectorAll<HTMLSelectElement>('select')[1];
    status.value = 'archived';
    status.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(names(el)).toEqual(['Old coat']);
  });

  it('summarises price and stock, and flags a design with no sizes', async () => {
    const { el } = await setup([
      product(1, 'Two prices', 'active', {
        variants: [
          { id: 1, price_eur: 25, active: true, stock: { qty_physical: 2, qty_available: 2 } },
          { id: 2, price_eur: 35, active: true, stock: { qty_physical: 3, qty_available: 3 } },
        ],
      }),
      product(2, 'Empty', 'active', { variants: [] }),
    ]);
    const items = [...el.querySelectorAll('.item')];
    expect(items[0].textContent).toContain('€25.00 – €35.00');
    expect(items[0].textContent).toContain('5 in stock');
    expect(items[1].textContent).toContain('No sizes yet');
  });

  it('uses the cover photo as the thumbnail', async () => {
    const { el } = await setup([
      product(1, 'With photos', 'active', {
        images: [
          { storage_path: '1/b.jpg', is_primary: false, sort_order: 1 },
          { storage_path: '1/a.jpg', is_primary: true, sort_order: 2 },
        ],
      }),
    ]);
    expect(el.querySelector('.thumb img')?.getAttribute('src')).toBe('https://files.test/1/a_t.jpg');
  });

  it('invites the first design when there are none', async () => {
    const { el } = await setup([]);
    expect(el.textContent).toContain('No designs yet');
  });

  it('shows a readable message when loading fails', async () => {
    const { el } = await setup(new Error('Couldn’t load the products.'));
    expect(el.querySelector('.notice-error')?.textContent).toContain('Couldn’t load the products.');
  });
});
