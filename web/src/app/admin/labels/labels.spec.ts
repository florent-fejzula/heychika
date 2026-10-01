import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Catalogue, LabelVariant } from '../../core/catalogue';
import { Purchases } from '../../core/purchases';
import { Labels } from './labels';

const COLOUR_CODE: Record<string, string> = { Black: 'BLK', Red: 'RED' };

function variant(id: number, productId: number, productName: string, color: string, size: string, order: number, stock = 0): LabelVariant {
  const sku = `DR-00${productId}-${COLOUR_CODE[color]}-${size}`;
  return {
    id, sku, barcode: sku,
    price_eur: 30, active: true,
    product: { id: productId, name: productName, status: 'active' },
    color: { name: color }, size: { label: size, sort_order: order },
    stock: { qty_physical: stock },
  };
}

const rows: LabelVariant[] = [
  variant(1, 1, 'Wrap dress', 'Black', 'M', 30, 5),
  variant(2, 1, 'Wrap dress', 'Black', 'S', 20, 3),
  variant(3, 1, 'Wrap dress', 'Red', 'S', 20, 0),
  variant(4, 2, 'Slip dress', 'Black', 'M', 30, 2),
];

async function setup(product?: string, purchase?: string) {
  const stub = { labelVariants: vi.fn().mockResolvedValue(rows) };
  // Variant 1 (Black M) and 4 (Slip dress Black M) arrived: 5 and 2 of them.
  const purchases = { quantities: vi.fn().mockResolvedValue([{ variant_id: 1, qty: 5 }, { variant_id: 4, qty: 2 }]) };
  TestBed.configureTestingModule({ providers: [{ provide: Catalogue, useValue: stub }, { provide: Purchases, useValue: purchases }] });
  const fixture = TestBed.createComponent(Labels);
  if (product) fixture.componentRef.setInput('product', product);
  if (purchase) fixture.componentRef.setInput('purchase', purchase);
  await settle(fixture);
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
  await fixture.whenStable();
}

// The first card is the paper settings; the rest are one per design.
const designs = (el: HTMLElement) => [...el.querySelectorAll('section.card')].filter((s) => s.querySelector('h2'));
const printButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.page-head .btn-primary')!;
const click = (el: HTMLElement, text: string, within: ParentNode = el) =>
  [...within.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === text)!.click();

describe('Labels', () => {
  it('lists designs with their sizes in size order, not alphabetical', async () => {
    const { el } = await setup();
    const sections = designs(el);
    expect(sections.map((s) => s.querySelector('h2')!.textContent)).toEqual(['Slip dress', 'Wrap dress']);
    const wrap = [...sections[1].querySelectorAll('.what strong')].map((s) => s.textContent);
    expect(wrap).toEqual(['S', 'M', 'S']); // Black S, Black M, Red S
  });

  it('starts with nothing selected and print disabled', async () => {
    const { el } = await setup();
    expect(printButton(el).disabled).toBe(true);
    expect(el.querySelector('.sheets')).toBeNull();
  });

  it('opens with a design’s sizes ready to print when sent from that design', async () => {
    const { el } = await setup('1');
    expect(printButton(el).textContent).toContain('Print 3 labels');
  });

  it('prints one sticker per item that arrived, when sent from a received buying trip', async () => {
    const { el } = await setup(undefined, '9');
    expect(printButton(el).textContent).toContain('Print 7 labels'); // 5 + 2
    const counts = [...el.querySelectorAll<HTMLInputElement>('.stepper input')].map((i) => i.value);
    expect(counts.filter((c) => c !== '0').sort()).toEqual(['2', '5']);
  });

  it('prints one label per size, or as many as are in stock', async () => {
    const { fixture, el } = await setup();
    const wrap = designs(el)[1];

    click(el, '1 each', wrap);
    await settle(fixture);
    expect(printButton(el).textContent).toContain('Print 3 labels');

    click(el, 'As in stock', wrap);
    await settle(fixture);
    expect(printButton(el).textContent).toContain('Print 8 labels'); // 5 + 3 + 0

    click(el, 'None', wrap);
    await settle(fixture);
    expect(printButton(el).disabled).toBe(true);
  });

  it('lays labels out across pages and can skip used positions', async () => {
    const { fixture, el } = await setup();
    const slip = designs(el)[0];
    const copies = slip.querySelector<HTMLInputElement>('.stepper input')!;
    copies.value = '23';
    copies.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(el.querySelectorAll('.page').length).toBe(1);
    expect(el.querySelectorAll('.label').length).toBe(23);

    const skip = el.querySelector<HTMLInputElement>('input[type=number][max]')!;
    skip.value = '2';
    skip.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(el.querySelectorAll('.page').length).toBe(2); // 2 + 23 = 25 positions on 24-label sheets
    expect(el.querySelectorAll('.label').length).toBe(23);
  });

  it('puts the label text on the sticker', async () => {
    const { fixture, el } = await setup();
    click(el, '1 each', designs(el)[0]);
    await settle(fixture);
    const label = el.querySelector('.label')!;
    expect(label.querySelector('.name')?.textContent).toBe('Slip dress');
    expect(label.querySelector('.opts')?.textContent).toContain('Black · M');
    expect(label.querySelector('.sku')?.textContent).toBe('DR-002-BLK-M');
    expect(label.querySelector('.opts')?.textContent).not.toContain('€');
  });

  it('adds the price only when asked', async () => {
    const { fixture, el } = await setup();
    click(el, '1 each', designs(el)[0]);
    el.querySelector<HTMLInputElement>('.card .check input')!.click();
    await settle(fixture);
    expect(el.querySelector('.label .opts')?.textContent).toContain('€30.00');
  });

  it('filters by search without losing what is already chosen', async () => {
    const { fixture, el } = await setup();
    click(el, '1 each', designs(el)[0]); // Slip dress chosen
    const search = el.querySelector<HTMLInputElement>('input[type=search]')!;
    search.value = 'wrap';
    search.dispatchEvent(new Event('input'));
    await settle(fixture);
    const shown = [...el.querySelectorAll('section.card h2')].map((h) => h.textContent);
    expect(shown).toEqual(['Slip dress', 'Wrap dress']); // Slip stays: it has labels chosen
    expect(printButton(el).textContent).toContain('Print 1 label');
  });

  it('puts the paper size into a print rule while open, and removes it on leaving', async () => {
    const { fixture } = await setup();
    const rule = () => [...document.head.querySelectorAll('style')].find((s) => s.textContent?.includes('@page'));
    expect(rule()?.textContent).toContain('size: 210mm 297mm');
    fixture.destroy();
    expect(rule()).toBeUndefined();
  });
});
