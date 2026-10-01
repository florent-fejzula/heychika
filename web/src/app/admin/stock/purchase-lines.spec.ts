import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Catalogue, ProductSummary, VariantRow } from '../../core/catalogue';
import { PurchaseLine, Purchases } from '../../core/purchases';
import { PurchaseLines } from './purchase-lines';

const design = (id: number, name: string): ProductSummary => ({
  id, name, model_code: String(id).padStart(3, '0'), status: 'active', show_online: true, featured: false,
  category: { code: 'DR', name: 'Dresses' }, variants: [], images: [],
});

function variant(id: number, colorId: number, color: string, sizeId: number, size: string, order: number): VariantRow {
  return {
    id, product_id: 7, color_id: colorId, size_id: sizeId, sku: `DR-007-${color.slice(0, 3).toUpperCase()}-${size}`, barcode: '',
    price_eur: 30, cost_eur: 0, locked: false, active: true,
    color: { code: color.slice(0, 3).toUpperCase(), name: color, hex: '#111' }, size: { code: size, label: size, sort_order: order }, stock: null,
  };
}

// Black S, Black M, Red S. Red M does not exist.
const variants = [variant(1, 1, 'Black', 1, 'S', 20), variant(2, 1, 'Black', 2, 'M', 30), variant(3, 2, 'Red', 1, 'S', 20)];

function held(variantId: number, qty: number, price: number): PurchaseLine {
  return {
    id: variantId, purchase_id: 9, variant_id: variantId, qty, unit_price: price, unit_price_eur: null, allocated_extra_eur: null, unit_landed_cost_eur: null,
    variant: { sku: '', cost_eur: 0, product: { id: 7, name: 'Wrap dress' }, color: { name: '', hex: null }, size: { label: '', sort_order: 0 }, stock: null },
  };
}

async function setup(lines: PurchaseLine[] = []) {
  // Design 7 has the three sizes above; any other design has one size of its own.
  const other = [variant(10, 3, 'Blue', 1, 'S', 20)];
  const catalogue = { listVariants: vi.fn((id: number) => Promise.resolve(id === 7 ? variants : other)) };
  const purchases = { saveLines: vi.fn().mockResolvedValue(undefined), removeLines: vi.fn().mockResolvedValue(undefined) };
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: Catalogue, useValue: catalogue }, { provide: Purchases, useValue: purchases }],
  });
  const fixture = TestBed.createComponent(PurchaseLines);
  fixture.componentRef.setInput('purchaseId', 9);
  fixture.componentRef.setInput('currency', 'TRY');
  fixture.componentRef.setInput('designs', [design(7, 'Wrap dress'), design(8, 'Slip dress')]);
  fixture.componentRef.setInput('lines', lines);
  const saved = vi.fn();
  fixture.componentInstance.saved.subscribe(saved);
  await settle(fixture);
  return { fixture, catalogue, purchases, saved, el: fixture.nativeElement as HTMLElement };
}

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 4; i++) {
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }
}

async function choose(fixture: ComponentFixture<unknown>, el: HTMLElement, id: string) {
  const select = el.querySelector<HTMLSelectElement>('select')!;
  select.value = id;
  select.dispatchEvent(new Event('change'));
  await settle(fixture);
}

const cell = (el: HTMLElement, label: string) => el.querySelector<HTMLInputElement>(`input[aria-label="${label}, how many"]`)!;
const priceInput = (el: HTMLElement) => [...el.querySelectorAll<HTMLLabelElement>('label.field')].find((l) => l.textContent!.includes('Paid per item'))!.querySelector('input')!;
const save = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes('Save to this trip'))!;

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('PurchaseLines', () => {
  it('offers the designs, narrowed by what is typed', async () => {
    const { fixture, el } = await setup();
    const names = () => [...el.querySelectorAll('select option')].slice(1).map((o) => o.textContent!.split('·')[0].trim());
    expect(names()).toEqual(['Slip dress', 'Wrap dress']);

    type(el.querySelector<HTMLInputElement>('input[type=search]')!, 'wrap');
    await settle(fixture);
    expect(names()).toEqual(['Wrap dress']);
  });

  it('lays out a grid of colours and sizes, with a dash where a colour does not come in that size', async () => {
    const { fixture, el } = await setup();
    await choose(fixture, el, '7');
    // The first header cell is the colour column, labelled for screen readers only.
    expect([...el.querySelectorAll('thead th')].map((h) => h.textContent!.trim()).slice(1)).toEqual(['S', 'M']);
    expect(cell(el, 'Black S')).toBeTruthy();
    expect(cell(el, 'Black M')).toBeTruthy();
    expect(cell(el, 'Red S')).toBeTruthy();
    expect(cell(el, 'Red M')).toBeNull();
    expect(el.querySelector('.none')).toBeTruthy();
  });

  it('saves the quantities entered, at the price in the trip’s currency', async () => {
    const { fixture, purchases, saved, el } = await setup();
    await choose(fixture, el, '7');
    type(cell(el, 'Black S'), '3');
    type(cell(el, 'Black M'), '2');
    type(priceInput(el), '450,50');
    await settle(fixture);
    expect(el.textContent).toContain('5 items of this design');

    save(el).click();
    await settle(fixture);

    expect(purchases.saveLines).toHaveBeenCalledWith(9, [
      { variant_id: 1, qty: 3, unit_price: 450.5 },
      { variant_id: 2, qty: 2, unit_price: 450.5 },
    ]);
    expect(saved).toHaveBeenCalled();
    expect(el.querySelector('.notice-ok')?.textContent).toContain('5 items');
  });

  it('will not save quantities without a price', async () => {
    const { fixture, purchases, el } = await setup();
    await choose(fixture, el, '7');
    type(cell(el, 'Black S'), '3');
    await settle(fixture);
    save(el).click();
    await settle(fixture);
    expect(purchases.saveLines).not.toHaveBeenCalled();
    expect(el.querySelector('.notice-error')?.textContent).toContain('TRY');
  });

  it('rejects a quantity that is not a number, naming the box', async () => {
    const { fixture, purchases, el } = await setup();
    await choose(fixture, el, '7');
    type(cell(el, 'Red S'), 'two');
    type(priceInput(el), '10');
    await settle(fixture);
    save(el).click();
    await settle(fixture);
    expect(purchases.saveLines).not.toHaveBeenCalled();
    expect(el.querySelector('.notice-error')?.textContent).toContain('Red S');
  });

  it('asks for something to be entered before saving', async () => {
    const { fixture, purchases, el } = await setup();
    await choose(fixture, el, '7');
    type(priceInput(el), '10');
    await settle(fixture);
    save(el).click();
    await settle(fixture);
    expect(purchases.saveLines).not.toHaveBeenCalled();
    expect(el.querySelector('.notice-error')?.textContent).toContain('at least one box');
  });

  it('shows what the trip already holds for the design, so saving corrects rather than duplicates', async () => {
    const { fixture, el } = await setup([held(1, 4, 300), held(3, 6, 300)]);
    await choose(fixture, el, '7');
    expect(cell(el, 'Black S').value).toBe('4');
    expect(cell(el, 'Red S').value).toBe('6');
    expect(cell(el, 'Black M').value).toBe('');
    expect(priceInput(el).value).toBe('300');
  });

  it('removes an item when its box is emptied', async () => {
    const { fixture, purchases, el } = await setup([held(1, 4, 300), held(3, 6, 300)]);
    await choose(fixture, el, '7');
    type(cell(el, 'Red S'), '0');
    await settle(fixture);
    save(el).click();
    await settle(fixture);
    expect(purchases.saveLines).toHaveBeenCalledWith(9, [{ variant_id: 1, qty: 4, unit_price: 300 }]);
    expect(purchases.removeLines).toHaveBeenCalledWith(9, [3]);
  });

  it('does not carry the previous design’s price over to the next one', async () => {
    const { fixture, el } = await setup([held(1, 4, 300)]);
    await choose(fixture, el, '7');
    expect(priceInput(el).value).toBe('300');
    await choose(fixture, el, '8');
    expect(priceInput(el).value).toBe('');
  });

  it('fills every box with the same number', async () => {
    const { fixture, el } = await setup();
    await choose(fixture, el, '7');
    const fill = [...el.querySelectorAll<HTMLLabelElement>('label.field')].find((l) => l.textContent!.includes('Same number'))!;
    type(fill.querySelector('input')!, '2');
    fill.querySelector('button')!.click();
    await settle(fixture);
    expect(['Black S', 'Black M', 'Red S'].map((l) => cell(el, l).value)).toEqual(['2', '2', '2']);
  });

  it('points to the design when it has no colours or sizes yet', async () => {
    const { fixture, catalogue, el } = await setup();
    catalogue.listVariants.mockResolvedValue([]);
    await choose(fixture, el, '8');
    expect(el.textContent).toContain('has no colours or sizes yet');
    expect(el.querySelector('a[href="/admin/products/8"]')).toBeTruthy();
  });

  it('shows an error and keeps the entries when saving fails', async () => {
    const { fixture, purchases, saved, el } = await setup();
    purchases.saveLines.mockRejectedValue(new Error('Couldn’t save the items.'));
    await choose(fixture, el, '7');
    type(cell(el, 'Black S'), '3');
    type(priceInput(el), '10');
    await settle(fixture);
    save(el).click();
    await settle(fixture);
    expect(el.querySelector('.notice-error')?.textContent).toContain('Couldn’t save');
    expect(saved).not.toHaveBeenCalled();
    expect(cell(el, 'Black S').value).toBe('3');
  });
});
