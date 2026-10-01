import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Inventory, Movement, StockRow } from '../../core/inventory';
import { StockDetail } from './stock-detail';

function row(stock: Partial<NonNullable<StockRow['stock']>> = {}): StockRow {
  return {
    id: 1, sku: 'DR-001-BLK-M', active: true, cost_eur: 20,
    product: { id: 5, name: 'Wrap dress', status: 'active' },
    color: { name: 'Black', hex: '#111111' }, size: { label: 'M', sort_order: 30 },
    stock: { qty_physical: 8, qty_reserved: 2, qty_available: 6, qty_in_transit: 1, qty_damaged: 0, min_stock: 0, ...stock },
  };
}

function movement(over: Partial<Movement>): Movement {
  return {
    id: 1, type: 'stock_in', qty: 10, delta_physical: 10, delta_reserved: 0, delta_in_transit: 0, delta_damaged: 0,
    ref_type: null, ref_id: null, unit_cost_eur: null, note: null, user_id: null, created_at: '2026-10-01T10:30:00Z', ...over,
  };
}

async function setup(r: StockRow = row(), history: Movement[] = []) {
  const stub = {
    history: vi.fn().mockResolvedValue(history),
    people: vi.fn().mockResolvedValue(new Map([['u1', 'Arta']])),
    adjust: vi.fn().mockResolvedValue(undefined),
    markDamaged: vi.fn().mockResolvedValue(undefined),
    writeOff: vi.fn().mockResolvedValue(undefined),
    setMinStock: vi.fn().mockResolvedValue(undefined),
  };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Inventory, useValue: stub }] });
  const fixture = TestBed.createComponent(StockDetail);
  fixture.componentRef.setInput('row', r);
  const changed = vi.fn();
  fixture.componentInstance.changed.subscribe(changed);
  await settle(fixture);
  return { fixture, stub, changed, el: fixture.nativeElement as HTMLElement };
}

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 4; i++) {
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }
}

const field = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLLabelElement>('label.field')].find((l) => l.querySelector('span')!.textContent!.trim() === label)!.querySelector('input')!;
const button = (el: HTMLElement, text: RegExp | string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => (typeof text === 'string' ? b.textContent!.trim() === text : text.test(b.textContent!)))!;

// The recount button reads “Save (−3)” once the count differs; the low-stock one is just “Save”.
const RECOUNT_SAVE = /Save\s*\(/;

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('StockDetail', () => {
  it('shows the five levels and what an item costs', async () => {
    const { el } = await setup();
    const levels = [...el.querySelectorAll('.levels div')].map((d) => `${d.querySelector('dt')!.textContent} ${d.querySelector('dd')!.textContent}`);
    expect(levels).toEqual(['On the shelf 8', 'Reserved 2', 'Available 6', 'On the road 1', 'Damaged 0']);
    expect(el.textContent).toContain('€20.00');
  });

  describe('recount', () => {
    it('corrects the shelf to what was counted, by the difference, with a reason', async () => {
      const { fixture, stub, changed, el } = await setup();
      type(field(el, 'On the shelf now'), '5');
      type(field(el, 'Reason'), ' Stock check ');
      await settle(fixture);
      expect(button(el, /Save/).textContent).toContain('−3');

      button(el, RECOUNT_SAVE).click();
      await settle(fixture);

      expect(stub.adjust).toHaveBeenCalledWith(1, -3, 'Stock check');
      expect(changed).toHaveBeenCalled();
      expect(el.querySelector('.notice-ok')?.textContent).toContain('Count corrected to 5');
    });

    it('can add stock found as well as remove it', async () => {
      const { fixture, stub, el } = await setup();
      type(field(el, 'On the shelf now'), '11');
      type(field(el, 'Reason'), 'Found a box');
      await settle(fixture);
      button(el, RECOUNT_SAVE).click();
      await settle(fixture);
      expect(stub.adjust).toHaveBeenCalledWith(1, 3, 'Found a box');
    });

    it('insists on a reason so the history makes sense later', async () => {
      const { fixture, stub, el } = await setup();
      type(field(el, 'On the shelf now'), '5');
      await settle(fixture);
      button(el, RECOUNT_SAVE).click();
      await settle(fixture);
      expect(stub.adjust).not.toHaveBeenCalled();
      expect(el.querySelector('.notice-error')?.textContent).toContain('Say why');
    });

    it('does nothing when the count already matches', async () => {
      const { fixture, stub, el } = await setup();
      type(field(el, 'Reason'), 'Check');
      await settle(fixture);
      button(el, 'Save').click();
      await settle(fixture);
      expect(stub.adjust).not.toHaveBeenCalled();
      expect(el.querySelector('.notice-error')?.textContent).toContain('already says 8');
    });

    it('rejects a count that is not a whole number', async () => {
      const { fixture, stub, el } = await setup();
      type(field(el, 'On the shelf now'), '4.5');
      type(field(el, 'Reason'), 'Check');
      await settle(fixture);
      button(el, 'Save').click();
      await settle(fixture);
      expect(stub.adjust).not.toHaveBeenCalled();
      expect(el.querySelector('.notice-error')?.textContent).toContain('whole number');
    });

    it('explains when the count would go below what orders are waiting for', async () => {
      const { fixture, stub, el } = await setup();
      stub.adjust.mockRejectedValue(new Error('That would leave fewer on the shelf than are already promised to orders.'));
      type(field(el, 'On the shelf now'), '1');
      type(field(el, 'Reason'), 'Check');
      await settle(fixture);
      button(el, RECOUNT_SAVE).click();
      await settle(fixture);
      expect(el.querySelector('.notice-error')?.textContent).toContain('promised to orders');
    });
  });

  describe('damaged stock', () => {
    it('takes damaged items off sale', async () => {
      const { fixture, stub, el } = await setup();
      type(field(el, 'How many'), '2');
      type(field(el, 'What happened'), 'Stain on the sleeve');
      await settle(fixture);
      button(el, 'Mark damaged').click();
      await settle(fixture);
      expect(stub.markDamaged).toHaveBeenCalledWith(1, 2, 'Stain on the sleeve');
    });

    it('cannot mark more damaged than are on the shelf', async () => {
      const { fixture, stub, el } = await setup();
      type(field(el, 'How many'), '9');
      type(field(el, 'What happened'), 'Flood');
      await settle(fixture);
      button(el, 'Mark damaged').click();
      await settle(fixture);
      expect(stub.markDamaged).not.toHaveBeenCalled();
      expect(el.querySelector('.notice-error')?.textContent).toContain('Only 8 on the shelf');
    });

    it('offers write-off only when something is damaged', async () => {
      const none = await setup(row({ qty_damaged: 0 }));
      expect(button(none.el, 'Write off')).toBeUndefined();
      TestBed.resetTestingModule();

      const some = await setup(row({ qty_damaged: 3 }));
      expect(button(some.el, 'Write off')).toBeTruthy();
    });

    it('writes off damaged items with a reason', async () => {
      const { fixture, stub, el } = await setup(row({ qty_damaged: 3 }));
      const section = [...el.querySelectorAll('section.action')].find((s) => s.querySelector('h3')!.textContent === 'Write off damaged')!;
      const reason = [...section.querySelectorAll<HTMLInputElement>('input')][1];
      type(reason, 'Beyond repair');
      await settle(fixture);
      button(el, 'Write off').click();
      await settle(fixture);
      expect(stub.writeOff).toHaveBeenCalledWith(1, 3, 'Beyond repair'); // defaults to all damaged
    });
  });

  describe('low-stock warning', () => {
    it('saves a level, and 0 turns it off', async () => {
      const { fixture, stub, el } = await setup(row({ min_stock: 2 }));
      expect(field(el, 'Warn at or below').value).toBe('2');
      type(field(el, 'Warn at or below'), '5');
      await settle(fixture);
      [...el.querySelectorAll<HTMLButtonElement>('section.action:last-of-type button')];
      const save = [...el.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent!.trim() === 'Save').pop()!;
      save.click();
      await settle(fixture);
      expect(stub.setMinStock).toHaveBeenCalledWith(1, 5);
    });

    it('rejects a non-number', async () => {
      const { fixture, stub, el } = await setup();
      type(field(el, 'Warn at or below'), 'lots');
      await settle(fixture);
      [...el.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent!.trim() === 'Save').pop()!.click();
      await settle(fixture);
      expect(stub.setMinStock).not.toHaveBeenCalled();
    });
  });

  describe('history', () => {
    it('lists what happened, in plain words, with who and why', async () => {
      const { el } = await setup(row(), [
        movement({ id: 3, type: 'dispatch', qty: 2, delta_physical: -2, delta_reserved: -2, delta_in_transit: 2 }),
        movement({ id: 2, type: 'adjust', qty: -1, delta_physical: -1, note: 'Stock check', user_id: 'u1' }),
        movement({ id: 1, type: 'stock_in', qty: 10, delta_physical: 10, ref_type: 'purchase', ref_id: 4, unit_cost_eur: 23 }),
      ]);
      const items = [...el.querySelectorAll('.history li')].map((li) => li.textContent!.replace(/\s+/g, ' '));
      expect(items[0]).toContain('Sent out');
      expect(items[0]).toContain('shelf −2 · reserved −2 · on the road +2');
      expect(items[1]).toContain('Count corrected');
      expect(items[1]).toContain('“Stock check”');
      expect(items[1]).toContain('Arta');
      expect(items[2]).toContain('Received');
      expect(items[2]).toContain('cost €23.00 each');
      expect(el.querySelector<HTMLAnchorElement>('.history a')!.getAttribute('href')).toBe('/admin/stock/purchases/4');
    });

    it('says so when nothing has happened yet', async () => {
      const { el } = await setup(row(), []);
      expect(el.textContent).toContain('Nothing has happened to this size yet');
    });
  });
});
