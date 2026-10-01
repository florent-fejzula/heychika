import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Inventory, StockRow } from '../../core/inventory';
import { StockOverview } from './stock-overview';

function stock(over: Partial<NonNullable<StockRow['stock']>> = {}): NonNullable<StockRow['stock']> {
  return { qty_physical: 0, qty_reserved: 0, qty_available: 0, qty_in_transit: 0, qty_damaged: 0, min_stock: 0, ...over };
}

const DESIGN_ID: Record<string, number> = { 'Wrap dress': 10, 'Slip dress': 11, 'Old coat': 12 };

function row(id: number, product: string, color: string, size: string, order: number, s: Partial<NonNullable<StockRow['stock']>>, over: Partial<StockRow> = {}): StockRow {
  return {
    id, sku: `${product.slice(0, 2).toUpperCase()}-${color.slice(0, 3).toUpperCase()}-${size}`, active: true, cost_eur: 20,
    product: { id: DESIGN_ID[product], name: product, status: 'active' }, color: { name: color, hex: '#111' }, size: { label: size, sort_order: order },
    stock: stock(s), ...over,
  };
}

const rows: StockRow[] = [
  row(1, 'Wrap dress', 'Black', 'M', 30, { qty_physical: 3, qty_available: 3, min_stock: 5 }), // running low
  row(2, 'Wrap dress', 'Black', 'S', 20, { qty_physical: 0 }), // sold out
  row(3, 'Wrap dress', 'Red', 'S', 20, { qty_physical: 10, qty_available: 10 }),
  row(4, 'Slip dress', 'Black', 'M', 30, { qty_physical: 2, qty_available: 2, qty_in_transit: 1, qty_damaged: 1 }),
  row(5, 'Old coat', 'Grey', 'L', 40, { qty_physical: 50, qty_available: 50 }, { product: { id: 99, name: 'Old coat', status: 'archived' } }),
];

async function setup(data: StockRow[] | Error = rows, find?: string) {
  const stub = {
    overview: data instanceof Error ? vi.fn().mockRejectedValue(data) : vi.fn().mockResolvedValue(data),
    history: vi.fn().mockResolvedValue([]),
    people: vi.fn().mockResolvedValue(new Map()),
  };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Inventory, useValue: stub }] });
  const fixture = TestBed.createComponent(StockOverview);
  if (find) fixture.componentRef.setInput('find', find);
  await settle(fixture);
  return { fixture, stub, el: fixture.nativeElement as HTMLElement };
}

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 4; i++) {
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }
}

const shown = (el: HTMLElement) =>
  [...el.querySelectorAll('section.group')].map((g) => ({
    design: g.querySelector('header a')!.textContent!.trim(),
    rows: [...g.querySelectorAll('.row .what')].map((w) => w.textContent!.replace(/\s+/g, ' ').trim()),
  }));
const chip = (el: HTMLElement, text: string) => [...el.querySelectorAll<HTMLLabelElement>('label.chip')].find((l) => l.textContent!.includes(text))!;
const tile = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll('.tile')].find((t) => t.querySelector('.label')!.textContent === label)!.querySelector('strong')!.textContent;

describe('StockOverview', () => {
  it('totals what is on the shelf, what it is worth, and what is out or damaged', async () => {
    const { el } = await setup();
    expect(tile(el, 'On the shelf')).toBe('15'); // 3 + 0 + 10 + 2; the archived coat is left out
    expect(tile(el, 'Worth')).toBe('€300.00'); // 15 × €20
    expect(tile(el, 'On the road')).toBe('1');
    expect(tile(el, 'Damaged')).toBe('1');
  });

  it('groups sizes under their design in size order and leaves archived designs out', async () => {
    const { el } = await setup();
    const g = shown(el);
    expect(g.map((x) => x.design)).toEqual(['Slip dress', 'Wrap dress']);
    expect(g[1].rows[0]).toContain('Black · S');
    expect(g[1].rows[1]).toContain('Black · M');
    expect(g[1].rows[2]).toContain('Red · S');
  });

  it('flags sizes that are sold out or running low', async () => {
    const { el } = await setup();
    const text = (el.querySelector('section.group') as HTMLElement).parentElement!.textContent!;
    expect(text).toContain('Sold out');
    expect(text).toContain('Running low');
  });

  it('filters to what needs attention', async () => {
    const { fixture, el } = await setup();
    for (const [filter, expected] of [
      ['Running low', ['Black · M']],
      ['Sold out', ['Black · S']],
      ['On the road', ['Black · M']],
      ['Damaged', ['Black · M']],
    ] as const) {
      chip(el, filter).querySelector('input')!.click();
      await settle(fixture);
      const all = shown(el).flatMap((g) => g.rows);
      expect(all.length, filter).toBe(1);
      expect(all[0], filter).toContain(expected[0]);
    }
  });

  it('shows how many need attention on each filter', async () => {
    const { el } = await setup();
    expect(chip(el, 'Running low').querySelector('.n')?.textContent).toBe('1');
    expect(chip(el, 'Sold out').querySelector('.n')?.textContent).toBe('1');
    expect(chip(el, 'Everything').querySelector('.n')).toBeNull();
  });

  it('searches by design, colour and SKU', async () => {
    const { fixture, el } = await setup();
    const search = el.querySelector<HTMLInputElement>('input[type=search]')!;
    for (const [q, designs] of [['slip', ['Slip dress']], ['red', ['Wrap dress']], ['WR-BLA-M', ['Wrap dress']]] as const) {
      search.value = q;
      search.dispatchEvent(new Event('input'));
      await settle(fixture);
      expect(shown(el).map((g) => g.design), q).toEqual([...designs]);
    }
  });

  it('starts filtered when sent here with a SKU (from the scan page)', async () => {
    const { el } = await setup(rows, 'SL-BLA-M');
    expect(shown(el).map((g) => g.design)).toEqual(['Slip dress']);
  });

  it('opens the controls for a size when tapped, and closes them again', async () => {
    const { fixture, el } = await setup();
    expect(el.querySelector('app-stock-detail')).toBeNull();
    el.querySelector<HTMLButtonElement>('.row')!.click();
    await settle(fixture);
    expect(el.querySelector('app-stock-detail')).toBeTruthy();
    el.querySelector<HTMLButtonElement>('.row')!.click();
    await settle(fixture);
    expect(el.querySelector('app-stock-detail')).toBeNull();
  });

  it('points to the first step when there is no stock at all', async () => {
    const { el } = await setup([]);
    expect(el.textContent).toContain('No stock yet');
    expect(el.querySelector('a[href="/admin/stock/purchases/new"]')).toBeTruthy();
  });

  it('shows a readable error when loading fails', async () => {
    const { el } = await setup(new Error('Couldn’t load the stock.'));
    expect(el.querySelector('.notice-error')?.textContent).toContain('Couldn’t load the stock.');
  });
});
