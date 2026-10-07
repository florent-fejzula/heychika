import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Catalogue, Colour, Size, VariantRow } from '../../core/catalogue';
import { VariantManager } from './variant-manager';

const colours: Colour[] = [
  { id: 1, code: 'BLK', name: 'Black', hex: '#111111', sort_order: 10, active: true },
  { id: 2, code: 'RED', name: 'Red', hex: '#cc0000', sort_order: 20, active: true },
];
const sizes: Size[] = [
  { id: 1, code: 'S', label: 'S', size_type: 'letter', sort_order: 20, active: true },
  { id: 2, code: 'M', label: 'M', size_type: 'letter', sort_order: 30, active: true },
  { id: 3, code: '38', label: '38', size_type: 'numeric', sort_order: 130, active: true },
];

function existing(colorId: number, sizeId: number, price = 29): VariantRow {
  const c = colours.find((x) => x.id === colorId)!;
  const s = sizes.find((x) => x.id === sizeId)!;
  return {
    id: colorId * 100 + sizeId, product_id: 7, color_id: colorId, size_id: sizeId,
    sku: `DR-001-${c.code}-${s.code}`, barcode: `DR-001-${c.code}-${s.code}`,
    price_eur: price, cost_eur: 0, locked: false, active: true,
    color: { code: c.code, name: c.name, hex: c.hex }, size: { code: s.code, label: s.label, sort_order: s.sort_order },
    stock: null,
  };
}

async function setup(rows: VariantRow[] = []) {
  const stub = {
    listVariants: vi.fn().mockResolvedValue(rows),
    addVariants: vi.fn().mockResolvedValue(undefined),
    setAllPrices: vi.fn().mockResolvedValue(undefined),
    updateVariant: vi.fn().mockResolvedValue(undefined),
    deleteVariant: vi.fn().mockResolvedValue(undefined),
  };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Catalogue, useValue: stub }] });
  const fixture = TestBed.createComponent(VariantManager);
  fixture.componentRef.setInput('productId', 7);
  fixture.componentRef.setInput('sizeType', 'letter');
  fixture.componentRef.setInput('colours', colours);
  fixture.componentRef.setInput('sizes', sizes);
  await settle(fixture);
  return { fixture, stub, el: fixture.nativeElement as HTMLElement };
}

async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable();
  await Promise.resolve();
  fixture.detectChanges();
  await fixture.whenStable();
}

const chip = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll<HTMLLabelElement>('label.chip')].find((l) => l.textContent!.trim() === text)!;
const addButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.add-row button')!;

describe('VariantManager', () => {
  it('offers the sizes that suit the category, and the rest on request', async () => {
    const { fixture, el } = await setup();
    expect(chip(el, 'S')).toBeTruthy();
    expect(chip(el, '38')).toBeUndefined();

    el.querySelector<HTMLInputElement>('.group .check input')!.click();
    await settle(fixture);
    expect(chip(el, '38')).toBeTruthy();
  });

  it('counts only combinations that do not exist yet', async () => {
    const { fixture, el } = await setup([existing(1, 1)]); // Black / S already exists
    for (const t of ['Black', 'Red', 'S', 'M']) {
      chip(el, t).querySelector('input')!.click();
    }
    await settle(fixture);
    expect(addButton(el).textContent).toContain('Add 3 sizes');
  });

  it('adds the ticked combinations at the typed price, accepting a comma', async () => {
    const { fixture, stub, el } = await setup();
    chip(el, 'Black').querySelector('input')!.click();
    chip(el, 'S').querySelector('input')!.click();
    chip(el, 'M').querySelector('input')!.click();
    const price = el.querySelector<HTMLInputElement>('.add-row input')!;
    price.value = '34,50';
    price.dispatchEvent(new Event('input'));
    await settle(fixture);

    addButton(el).click();
    await settle(fixture);

    expect(stub.addVariants).toHaveBeenCalledWith(7, [{ color_id: 1, size_id: 1 }, { color_id: 1, size_id: 2 }], 34.5);
  });

  it('will not add anything without a price', async () => {
    const { fixture, stub, el } = await setup();
    chip(el, 'Black').querySelector('input')!.click();
    chip(el, 'S').querySelector('input')!.click();
    await settle(fixture);

    addButton(el).click();
    await settle(fixture);

    expect(stub.addVariants).not.toHaveBeenCalled();
    expect(el.querySelector('.notice-error')?.textContent).toContain('price');
  });

  it('shows existing sizes grouped by colour with their SKUs', async () => {
    const { el } = await setup([existing(1, 1), existing(1, 2), existing(2, 1)]);
    const headings = [...el.querySelectorAll('.colour h3')].map((h) => h.textContent!.trim());
    expect(headings).toEqual(['Black', 'Red']);
    expect(el.textContent).toContain('DR-001-BLK-M');
  });

  it('saves a price edit, accepting a comma', async () => {
    const { fixture, stub, el } = await setup([existing(1, 1)]);
    const input = el.querySelector<HTMLInputElement>('.row .price input')!;
    input.value = '31,5';
    input.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(stub.updateVariant).toHaveBeenCalledWith(101, { price_eur: 31.5 });
  });

  it('rejects a price that is not a price, and saves nothing', async () => {
    const { fixture, stub, el } = await setup([existing(1, 1)]);
    const input = el.querySelector<HTMLInputElement>('.row .price input')!;
    input.value = 'cheap';
    input.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(stub.updateVariant).not.toHaveBeenCalled();
    expect(el.querySelector('.notice-error')).toBeTruthy();
  });

  it('shows a locked size as in use instead of offering to remove it', async () => {
    const locked = { ...existing(1, 1), locked: true };
    const { el } = await setup([locked, existing(1, 2)]);
    const rows = [...el.querySelectorAll('.row')];
    expect(rows[0].textContent).toContain('In use');
    expect(rows[0].querySelector('.btn-danger')).toBeNull();
    expect(rows[1].querySelector('.btn-danger')).toBeTruthy();
  });

  it('shows the cost and what she makes on it once a size has a cost', async () => {
    const { el } = await setup([{ ...existing(1, 1, 40), cost_eur: 20 }]);
    expect(el.querySelector('.row .price small')?.textContent).toContain('cost €20.00 · profit €20.00 (+100%)');
  });
});
