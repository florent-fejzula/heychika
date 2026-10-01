import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Catalogue, Category, Colour, ProductDetail, Size } from '../../core/catalogue';
import { ProductEditor } from './product-editor';

const categories: Category[] = [
  { id: 1, code: 'DR', name: 'Dresses', size_type: 'letter', sort_order: 10, active: true },
  { id: 2, code: 'JN', name: 'Jeans', size_type: 'numeric', sort_order: 20, active: true },
];

const detail: ProductDetail = {
  id: 5, category_id: 1, model_code: '003', name: 'Black wrap dress', slug: 'black-wrap-dress-dr-003',
  description: 'Soft satin', material: null, brand: null, status: 'draft', show_online: false, featured: false,
  category: { code: 'DR', name: 'Dresses', size_type: 'letter' },
};

async function setup(id?: string, product: ProductDetail | null = detail, variants: unknown[] = []) {
  const stub = {
    lookups: vi.fn().mockResolvedValue({ categories, colours: [] as Colour[], sizes: [] as Size[] }),
    getProduct: vi.fn().mockResolvedValue(product),
    createProduct: vi.fn().mockResolvedValue(42),
    updateProduct: vi.fn().mockResolvedValue(undefined),
    deleteProduct: vi.fn().mockResolvedValue(undefined),
    listVariants: vi.fn().mockResolvedValue(variants),
    listImages: vi.fn().mockResolvedValue([]),
    imageUrl: (p: string) => p,
  };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Catalogue, useValue: stub }] });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(ProductEditor);
  if (id !== undefined) fixture.componentRef.setInput('id', id);
  await settle(fixture);
  await settle(fixture); // the colours-and-sizes section loads on its own, after the form
  return { fixture, stub, navigate, el: fixture.nativeElement as HTMLElement };
}

async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
  await fixture.whenStable();
}

function type(el: HTMLElement, selector: string, value: string) {
  const input = el.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('change'));
}

describe('ProductEditor', () => {
  describe('new design', () => {
    it('asks for a category, and will not create one without it', async () => {
      const { fixture, stub, el } = await setup();
      expect(el.querySelector('select')).toBeTruthy();

      type(el, 'input[formControlName=name]', 'Red dress');
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await settle(fixture);

      expect(stub.createProduct).not.toHaveBeenCalled();
      expect(el.querySelector('.notice-error')?.textContent).toContain('category');
    });

    it('creates the design and moves on to its colours and sizes', async () => {
      const { fixture, stub, navigate, el } = await setup();
      const select = el.querySelector<HTMLSelectElement>('select')!;
      select.selectedIndex = 1; // “Choose…” is 0, Dresses is 1
      select.dispatchEvent(new Event('change'));
      type(el, 'input[formControlName=name]', '  Red dress  ');
      await settle(fixture);

      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await settle(fixture);

      expect(stub.createProduct).toHaveBeenCalledWith(expect.objectContaining({ category_id: 1, name: 'Red dress', status: 'draft', show_online: false }));
      expect(navigate).toHaveBeenCalledWith(['/admin/products', 42]);
    });

    it('does not offer colours, sizes or photos until the design exists', async () => {
      const { el } = await setup();
      expect(el.querySelector('app-variant-manager')).toBeNull();
      expect(el.querySelector('app-image-manager')).toBeNull();
    });
  });

  describe('existing design', () => {
    it('loads it into the form and fixes its category', async () => {
      const { el } = await setup('5');
      expect(el.querySelector<HTMLInputElement>('input[formControlName=name]')!.value).toBe('Black wrap dress');
      expect(el.querySelector('select[formControlName=category_id]')).toBeNull();
      expect(el.textContent).toContain('DR-003');
      expect(el.querySelector('app-variant-manager')).toBeTruthy();
      expect(el.querySelector('app-image-manager')).toBeTruthy();
    });

    it('saves changes without touching the category', async () => {
      const { fixture, stub, el } = await setup('5');
      type(el, 'input[formControlName=name]', 'Black satin wrap dress');
      await settle(fixture);
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await settle(fixture);

      expect(stub.updateProduct).toHaveBeenCalledWith(5, expect.objectContaining({ name: 'Black satin wrap dress', description: 'Soft satin', material: null }));
      expect(el.querySelector('.notice-ok')?.textContent).toContain('Saved');
    });

    it('says so when the design does not exist', async () => {
      const { el } = await setup('999', null);
      expect(el.textContent).toContain('Design not found');
    });

    it('treats a garbage id as not found without asking the database', async () => {
      const { stub, el } = await setup('abc');
      expect(stub.getProduct).not.toHaveBeenCalled();
      expect(el.textContent).toContain('Design not found');
    });

    it('offers deletion only while the design has no sizes', async () => {
      const empty = await setup('5');
      expect(empty.el.textContent).toContain('Delete design');
      TestBed.resetTestingModule();

      const withSizes = await setup('5', detail, [
        { id: 1, product_id: 5, color_id: 1, size_id: 1, sku: 'DR-003-BLK-S', barcode: 'DR-003-BLK-S', price_eur: 30, cost_eur: 0,
          locked: false, active: true, color: { code: 'BLK', name: 'Black', hex: null }, size: { code: 'S', label: 'S', sort_order: 20 }, stock: null },
      ]);
      expect(withSizes.el.textContent).not.toContain('Delete design');
    });
  });
});
