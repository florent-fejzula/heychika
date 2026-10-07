import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Catalogue, Category, Colour, ProductSummary, Size, VariantRow } from '../../core/catalogue';
import { PurchaseLine, PurchaseRow, PurchaseSummary, Purchases } from '../../core/purchases';
import { AddItem } from './add-item';

const categories: Category[] = [
  { id: 1, code: 'DR', name: 'Dresses', size_type: 'letter', sort_order: 1, active: true },
  { id: 2, code: 'BG', name: 'Bags', size_type: 'one_size', sort_order: 2, active: true },
];
const colours: Colour[] = [
  { id: 10, code: 'BLK', name: 'Black', hex: '#111', sort_order: 1, active: true },
  { id: 11, code: 'WHT', name: 'White', hex: '#fff', sort_order: 2, active: true },
];
const sizes: Size[] = [
  { id: 20, code: 'S', label: 'S', size_type: 'letter', sort_order: 1, active: true },
  { id: 21, code: 'M', label: 'M', size_type: 'letter', sort_order: 2, active: true },
  { id: 22, code: 'OS', label: 'One size', size_type: 'one_size', sort_order: 3, active: true },
  { id: 23, code: '38', label: '38', size_type: 'numeric', sort_order: 4, active: true },
];

const wrap: ProductSummary = {
  id: 5, name: 'Wrap dress', model_code: '001', status: 'active', show_online: true, featured: false,
  category: { code: 'DR', name: 'Dresses' }, variants: [], images: [{ storage_path: 'x.jpg', is_primary: true, sort_order: 0 }],
};

function variant(id: number, colour: Colour, size: Size, price = 39): VariantRow {
  return {
    id, product_id: 5, color_id: colour.id, size_id: size.id, sku: `DR-001-${colour.code}-${size.code}`, barcode: `DR-001-${colour.code}-${size.code}`,
    price_eur: price, cost_eur: 12, locked: true, active: true,
    color: { code: colour.code, name: colour.name, hex: colour.hex }, size: { code: size.code, label: size.label, sort_order: size.sort_order }, stock: null,
  };
}

function trip(over: Partial<PurchaseRow> = {}): PurchaseRow {
  return {
    id: 9, reference: 'Istanbul, October', supplier_name: null, purchase_date: '2026-10-01', currency: 'TRY', currency_per_eur: 40,
    extra_costs_eur: 20, allocation_method: 'by_quantity', status: 'draft', received_at: null, notes: null, ...over,
  };
}

function tripLine(variantId: number, qty: number, price: number): PurchaseLine {
  return {
    id: variantId, purchase_id: 9, variant_id: variantId, qty, unit_price: price, unit_price_eur: null, allocated_extra_eur: null, unit_landed_cost_eur: null,
    variant: { sku: 'X', barcode: 'X', cost_eur: 0, product: { id: 5, name: 'Wrap dress' }, color: { name: 'Black', hex: '#111' }, size: { label: 'M', sort_order: 2 }, stock: null },
  };
}

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 5; i++) {
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }
}

const summary = (t: PurchaseRow): PurchaseSummary => ({ ...t, lines: [] });

async function setup(opts: { tripId?: string; trip?: PurchaseRow | null; lines?: PurchaseLine[]; design?: string; variants?: VariantRow[]; trips?: PurchaseRow[] } = {}) {
  const catalogue = {
    lookups: vi.fn().mockResolvedValue({ categories, colours, sizes }),
    listProducts: vi.fn().mockResolvedValue([wrap]),
    listVariants: vi.fn().mockResolvedValue(opts.variants ?? []),
    uploadImage: vi.fn().mockResolvedValue(undefined),
    brands: vi.fn().mockResolvedValue(['Vavex', 'Zara']),
  };
  const purchases = {
    markup: vi.fn().mockResolvedValue(50),
    get: vi.fn().mockResolvedValue(opts.trip === undefined ? trip() : opts.trip),
    lines: vi.fn().mockResolvedValue(opts.lines ?? []),
    list: vi.fn().mockResolvedValue((opts.trips ?? [trip(), trip({ id: 3, reference: 'Old one', status: 'received' })]).map(summary)),
    create: vi.fn().mockResolvedValue(12),
    setExpectedItems: vi.fn().mockResolvedValue(undefined),
    saveItem: vi.fn().mockResolvedValue({ product_id: 77, purchase_id: 9, variant_ids: [1] }),
  };
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: Catalogue, useValue: catalogue }, { provide: Purchases, useValue: purchases }],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(AddItem);
  if (opts.tripId) fixture.componentRef.setInput('id', opts.tripId);
  if (opts.design) fixture.componentRef.setInput('design', opts.design);
  await settle(fixture);
  return { fixture, catalogue, purchases, navigate, el: fixture.nativeElement as HTMLElement };
}

const chip = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll<HTMLLabelElement>('label.chip')].find((c) => c.textContent!.trim() === text)!.querySelector('input')!;
const field = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLLabelElement>('label.field')].find((l) => l.querySelector('span')!.textContent!.startsWith(label))!.querySelector('input')!;
const box = (el: HTMLElement, label: string) => el.querySelector<HTMLInputElement>(`input[aria-label="${label}, how many"]`)!;
const saveButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button.btn-block')!;
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes(text))!;
const tripSelect = (el: HTMLElement) => el.querySelector<HTMLSelectElement>('select[aria-labelledby=trip-label]')!;

/** A dress in black M, as far as the money: the part every trip test shares. */
async function aDress(fixture: ComponentFixture<unknown>, el: HTMLElement, qty: string, paid: string, paidLabel = 'Paid per item') {
  type(field(el, 'Name'), 'Linen dress');
  await tick(fixture, chip(el, 'Dresses'));
  await tick(fixture, chip(el, 'Black'));
  await tick(fixture, chip(el, 'M'));
  type(box(el, 'Black M'), qty);
  type(field(el, paidLabel), paid);
  await settle(fixture);
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

async function tick(fixture: ComponentFixture<unknown>, input: HTMLInputElement) {
  input.click();
  await settle(fixture);
}

describe('AddItem', () => {
  describe('straight into stock', () => {
    it('takes a new product in one form, suggests its price, and opens it when done', async () => {
      const { fixture, el, purchases, navigate } = await setup();
      expect(el.textContent).toContain('Straight onto the shelf');

      type(field(el, 'Name'), ' Satin wrap dress ');
      await tick(fixture, chip(el, 'Dresses'));
      // Only letter sizes for dresses.
      expect([...el.querySelectorAll('label.chip')].map((c) => c.textContent!.trim())).not.toContain('38');
      await tick(fixture, chip(el, 'Black'));
      await tick(fixture, chip(el, 'S'));
      await tick(fixture, chip(el, 'M'));
      type(box(el, 'Black S'), '2');
      type(box(el, 'Black M'), '3');
      type(field(el, 'Paid per item'), '14');
      await settle(fixture);

      // €14 each, 50% markup: €21, filled in for her.
      expect(el.querySelector('.estimate')!.textContent).toContain('€14.00');
      expect(field(el, 'Selling price').value).toBe('21');
      expect(saveButton(el).textContent).toContain('Add 5 items to stock');

      saveButton(el).click();
      await settle(fixture);
      expect(purchases.saveItem).toHaveBeenCalledWith(null, {
        product_id: null, category_id: 1, name: 'Satin wrap dress', description: null, material: null, brand: null,
        show_online: true, featured: false, price_eur: 21, unit_price: 14,
        lines: [{ color_id: 10, size_id: 20, qty: 2 }, { color_id: 10, size_id: 21, qty: 3 }],
      });
      expect(navigate).toHaveBeenCalledWith(['/admin/products', 77], { queryParams: { added: 5, photos: null } });
    });

    it('keeps her own price once she types one', async () => {
      const { fixture, el } = await setup();
      type(field(el, 'Name'), 'Dress');
      await tick(fixture, chip(el, 'Dresses'));
      await tick(fixture, chip(el, 'Black'));
      await tick(fixture, chip(el, 'M'));
      type(box(el, 'Black M'), '1');
      type(field(el, 'Selling price'), '29.90');
      type(field(el, 'Paid per item'), '10');
      await settle(fixture);
      expect(field(el, 'Selling price').value).toBe('29.90');
      expect(el.querySelector('.estimate button')!.textContent).toContain('Use €15.00');
    });

    it('fills every box at once', async () => {
      const { fixture, el } = await setup();
      await tick(fixture, chip(el, 'Dresses'));
      await tick(fixture, chip(el, 'Black'));
      await tick(fixture, chip(el, 'White'));
      await tick(fixture, chip(el, 'S'));
      await tick(fixture, chip(el, 'M'));
      type(el.querySelector<HTMLInputElement>('input[aria-label="Same number in every box"]')!, '2');
      [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes('Same in every box'))!.click();
      await settle(fixture);
      expect(['Black S', 'Black M', 'White S', 'White M'].map((l) => box(el, l).value)).toEqual(['2', '2', '2', '2']);
    });

    it('needs no size choice for one-size things', async () => {
      const { fixture, el } = await setup();
      await tick(fixture, chip(el, 'Bags'));
      await tick(fixture, chip(el, 'Black'));
      expect(box(el, 'Black One size')).toBeTruthy();
    });

    it('says what is missing instead of saving', async () => {
      const { fixture, el, purchases } = await setup();
      saveButton(el).click();
      await settle(fixture);
      expect(el.querySelector('[role=alert]')!.textContent).toContain('Give it a name');

      type(field(el, 'Name'), 'Dress');
      await tick(fixture, chip(el, 'Dresses'));
      await tick(fixture, chip(el, 'Black'));
      await tick(fixture, chip(el, 'M'));
      saveButton(el).click();
      await settle(fixture);
      expect(el.querySelector('[role=alert]')!.textContent).toContain('how many you have');
      expect(purchases.saveItem).not.toHaveBeenCalled();
    });

    it('takes the rest of the design too, and offers the brands used before', async () => {
      const { fixture, el, purchases } = await setup();
      el.querySelector<HTMLTextAreaElement>('textarea')!.value = ' Loose fit ';
      el.querySelector('textarea')!.dispatchEvent(new Event('input'));
      type(field(el, 'Material'), 'Linen');
      const picks = () => [...el.querySelectorAll('app-brand-picks button')].map((b) => b.textContent!.trim());
      expect(picks()).toEqual(['Vavex', 'Zara']);

      // Typing narrows them; one tap fills the box.
      type(field(el, 'Brand'), 'va');
      await settle(fixture);
      expect(picks()).toEqual(['Vavex']);
      el.querySelector<HTMLButtonElement>('app-brand-picks button')!.click();
      await settle(fixture);
      expect(field(el, 'Brand').value).toBe('Vavex');
      expect(picks()).toEqual([]);

      await tick(fixture, [...el.querySelectorAll('label.check')].find((l) => l.textContent!.includes('Feature on the homepage'))!.querySelector('input')!);
      await aDress(fixture, el, '1', '10');
      saveButton(el).click();
      await settle(fixture);
      expect(purchases.saveItem).toHaveBeenCalledWith(null, expect.objectContaining({
        description: 'Loose fit', material: 'Linen', brand: 'Vavex', featured: true,
      }));
    });

    it('spells a brand the way it was written before', async () => {
      const { fixture, el, purchases } = await setup();
      type(field(el, 'Brand'), ' zara ');
      await aDress(fixture, el, '1', '10');
      saveButton(el).click();
      await settle(fixture);
      expect(purchases.saveItem).toHaveBeenCalledWith(null, expect.objectContaining({ brand: 'Zara' }));
    });

    it('takes a photo pasted with Ctrl+V, but leaves text pasted into a box alone', async () => {
      const { fixture, el } = await setup();
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
      const shot = new File(['x'], 'image.png', { type: 'image/png' });
      const paste = (target: EventTarget, types: string[]) => {
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: { types, files: [shot] } });
        target.dispatchEvent(event);
        return event;
      };

      expect(paste(document.body, ['Files']).defaultPrevented).toBe(true);
      await settle(fixture);
      expect(el.querySelectorAll('.photo').length).toBe(1);

      // Copied from Excel: text, with a picture of it. Into the name box, it's the text she wants.
      expect(paste(field(el, 'Name'), ['text/plain', 'Files']).defaultPrevented).toBe(false);
      await settle(fixture);
      expect(el.querySelectorAll('.photo').length).toBe(1);
    });

    it('uploads the photos after saving', async () => {
      const { fixture, el, catalogue } = await setup();
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
      const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
      const file = new File(['x'], 'front.jpg', { type: 'image/jpeg' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
      await settle(fixture);
      expect(el.querySelectorAll('.photo').length).toBe(1);

      type(field(el, 'Name'), 'Dress');
      await tick(fixture, chip(el, 'Dresses'));
      await tick(fixture, chip(el, 'Black'));
      await tick(fixture, chip(el, 'M'));
      type(box(el, 'Black M'), '1');
      type(field(el, 'Paid per item'), '10');
      await settle(fixture);
      saveButton(el).click();
      await settle(fixture);
      expect(catalogue.uploadImage).toHaveBeenCalledWith(77, file, 0);
    });
  });

  describe('on a buying trip', () => {
    it('prices in the trip’s currency and counts the trip costs in the suggestion', async () => {
      // Already 10 items on the trip; trip costs €20. Adding 10 more at 600 TRY (40 per €):
      // €15 each + €20 / 20 items = €16, + 50% = €24.
      const { fixture, el, purchases, navigate } = await setup({ tripId: '9', lines: [tripLine(99, 10, 400)] });
      expect(el.textContent).toContain('goes on the shelf when you receive the trip');
      expect(tripSelect(el).value).toBe('9');
      await aDress(fixture, el, '10', '600', 'Paid per item (TRY)');

      const estimate = el.querySelector('.estimate')!.textContent!;
      expect(estimate).toContain('€16.00 each: €15.00 paid + €1.00 trip costs');
      expect(estimate).toContain('(+€1.00 for the trip costs)');
      // The trip doesn't say how many items it brought, so the costs sit on the 20 entered.
      expect(estimate).toContain('only the 20 items entered so far');
      // Not filled in while it's a guess like that: she chooses.
      expect(field(el, 'Selling price').value).toBe('');
      button(el, 'Use €24.00').click();
      await settle(fixture);
      expect(field(el, 'Selling price').value).toBe('24');

      saveButton(el).click();
      await settle(fixture);
      expect(purchases.saveItem).toHaveBeenCalledWith(9, expect.objectContaining({ unit_price: 600, price_eur: 24 }));
      expect(navigate).toHaveBeenCalledWith(['/admin/stock/purchases', 9], { queryParams: { added: 10, name: 'Linen dress', photos: null } });
    });

    it('opens a design already on the trip with its sizes, numbers and prices, to correct them', async () => {
      const black = colours[0];
      const variants = [variant(1, black, sizes[0]), variant(2, black, sizes[1])];
      const { el, purchases, fixture } = await setup({ tripId: '9', design: '5', variants, lines: [tripLine(2, 4, 500)] });

      expect(el.querySelector('.chosen')!.textContent).toContain('Wrap dress');
      expect(chip(el, 'Black').checked).toBe(true);
      expect(chip(el, 'S').checked).toBe(true);
      expect(box(el, 'Black M').value).toBe('4');
      expect(field(el, 'Paid per item (TRY)').value).toBe('500');
      expect(field(el, 'Selling price').value).toBe('39');

      type(box(el, 'Black S'), '1');
      saveButton(el).click();
      await settle(fixture);
      expect(purchases.saveItem).toHaveBeenCalledWith(9, {
        product_id: 5, price_eur: 39, unit_price: 500,
        lines: [{ color_id: 10, size_id: 20, qty: 1 }, { color_id: 10, size_id: 21, qty: 4 }],
      });
    });

    it('is picked in the form when adding from Stock, and only trips not yet received are offered', async () => {
      const { fixture, el, purchases, navigate } = await setup({ lines: [tripLine(99, 10, 400)] });
      expect([...tripSelect(el).options].map((o) => o.textContent!.trim())).toEqual(['None: straight onto the shelf', 'Istanbul, October']);

      tripSelect(el).value = '9';
      tripSelect(el).dispatchEvent(new Event('change'));
      await settle(fixture);
      expect(purchases.lines).toHaveBeenCalledWith(9);
      await aDress(fixture, el, '10', '600', 'Paid per item (TRY)');
      type(field(el, 'Selling price'), '25');

      saveButton(el).click();
      await settle(fixture);
      expect(purchases.saveItem).toHaveBeenCalledWith(9, expect.objectContaining({ unit_price: 600, price_eur: 25 }));
      expect(navigate).toHaveBeenCalledWith(['/admin/stock/purchases', 9], expect.anything());
    });

    it('can be made on the spot, and the item carries on with it, its costs spread over the items it brought', async () => {
      const { fixture, el, purchases } = await setup({ trips: [] });
      await aDress(fixture, el, '6', '10');
      expect(field(el, 'Selling price').value).toBe('15');

      button(el, 'New trip').click();
      await settle(fixture);
      const panel = el.querySelector<HTMLElement>('.new-trip')!;
      type(field(panel, 'Name'), 'Istanbul, October 2026');
      type(field(panel, 'Trip costs'), '300');
      type(field(panel, 'About how many items'), '150');
      const created = trip({ id: 12, reference: 'Istanbul, October 2026', currency: 'EUR', currency_per_eur: 1, extra_costs_eur: 300, expected_items: 150 });
      purchases.get.mockResolvedValue(created);
      purchases.list.mockResolvedValue([summary(created)]);
      button(el, 'Create the trip and carry on').click();
      await settle(fixture);

      expect(purchases.create).toHaveBeenCalledWith(expect.objectContaining({
        reference: 'Istanbul, October 2026', currency: 'EUR', currency_per_eur: 1, extra_costs_eur: 300, expected_items: 150,
      }));
      expect(tripSelect(el).value).toBe('12');
      // What she typed is all still there.
      expect(field(el, 'Name').value).toBe('Linen dress');
      expect(box(el, 'Black M').value).toBe('6');

      // €10 + €300 / 150 items = €12, + 50% = €18: €3 more because of the trip.
      const estimate = el.querySelector('.estimate')!.textContent!;
      expect(estimate).toContain('€10.00 paid + €2.00 trip costs');
      expect(estimate).toContain('(+€3.00 for the trip costs)');
      expect(estimate).toContain('spread over about 150 items');
      expect(field(el, 'Selling price').value).toBe('18');
    });

    it('asks a trip without one about how many items it brought, and spreads its costs over them', async () => {
      const { fixture, el, purchases } = await setup({ tripId: '9', lines: [tripLine(99, 10, 400)] });
      await aDress(fixture, el, '10', '600', 'Paid per item (TRY)');
      const ask = el.querySelector<HTMLInputElement>('input[aria-labelledby=expected-label]')!;
      expect(el.querySelector('#expected-label')!.textContent).toContain('About how many items did “Istanbul, October” bring?');

      type(ask, '100');
      button(el, 'Save').click();
      await settle(fixture);
      expect(purchases.setExpectedItems).toHaveBeenCalledWith(9, 100);
      // €20 over 100 items: €0.20 each, so €15.20 + 50% = €23, now filled in.
      expect(el.querySelector('.estimate')!.textContent).toContain('€15.00 paid + €0.20 trip costs');
      expect(field(el, 'Selling price').value).toBe('23');
      expect(el.querySelector('input[aria-labelledby=expected-label]')).toBeNull();
    });

    it('won’t add to a trip that is already received', async () => {
      const { el } = await setup({ tripId: '9', trip: trip({ status: 'received' }) });
      expect(el.textContent).toContain('already received');
      expect(el.querySelector('a[href="/admin/stock/add"]')).toBeTruthy();
    });
  });

  describe('more of one she has', () => {
    it('finds the design by name and ticks its colours and sizes', async () => {
      const variants = [variant(1, colours[0], sizes[1])];
      const { fixture, el } = await setup({ variants });
      await tick(fixture, chip(el, 'More of one I have'));
      type(el.querySelector<HTMLInputElement>('input[type=search]')!, 'wrap');
      await settle(fixture);
      el.querySelector<HTMLButtonElement>('button.match')!.click();
      await settle(fixture);
      expect(chip(el, 'Black').checked).toBe(true);
      expect(chip(el, 'M').checked).toBe(true);
      expect(chip(el, 'S').checked).toBe(false);
    });
  });
});
