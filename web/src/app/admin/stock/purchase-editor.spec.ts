import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Catalogue } from '../../core/catalogue';
import { PurchaseLine, PurchaseRow, Purchases } from '../../core/purchases';
import { PurchaseEditor } from './purchase-editor';

function purchase(over: Partial<PurchaseRow> = {}): PurchaseRow {
  return {
    id: 9, reference: 'Istanbul, October', supplier_name: null, purchase_date: '2026-10-01', currency: 'EUR', currency_per_eur: 1,
    extra_costs_eur: 400, allocation_method: 'by_quantity', status: 'draft', received_at: null, notes: null, ...over,
  };
}

function line(id: number, qty: number, price: number, over: Partial<PurchaseLine> = {}, stock: { qty_physical: number } | null = null, cost = 0): PurchaseLine {
  return {
    id, purchase_id: 9, variant_id: id, qty, unit_price: price, unit_price_eur: null, allocated_extra_eur: null, unit_landed_cost_eur: null,
    variant: {
      sku: `DR-001-BLK-${id}`, barcode: `DR-001-BLK-${id}`, cost_eur: cost, product: { id: 5, name: 'Wrap dress' }, color: { name: 'Black', hex: '#111' },
      size: { label: id === 1 ? 'S' : 'M', sort_order: id * 10 }, stock,
    },
    ...over,
  };
}

async function setup(id: string | undefined, p: PurchaseRow | null = purchase(), lines: PurchaseLine[] = []) {
  const purchases = {
    get: vi.fn().mockResolvedValue(p),
    lines: vi.fn().mockResolvedValue(lines),
    create: vi.fn().mockResolvedValue(42),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    removeLines: vi.fn().mockResolvedValue(undefined),
    receive: vi.fn().mockResolvedValue(undefined),
  };
  const catalogue = { listProducts: vi.fn().mockResolvedValue([]), listVariants: vi.fn().mockResolvedValue([]) };
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: Purchases, useValue: purchases }, { provide: Catalogue, useValue: catalogue }],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(PurchaseEditor);
  if (id !== undefined) fixture.componentRef.setInput('id', id);
  await settle(fixture);
  return { fixture, purchases, navigate, el: fixture.nativeElement as HTMLElement };
}

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 5; i++) {
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  }
}

const field = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLLabelElement>('form label.field')].find((l) => l.querySelector('span')!.textContent!.includes(label))?.querySelector<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>('input, select, textarea');
const button = (el: HTMLElement, text: RegExp | string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => (typeof text === 'string' ? b.textContent!.trim() === text : text.test(b.textContent!.trim())));
const sum = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll('.sum div')].find((d) => d.querySelector('dt')!.textContent === label)?.querySelector('dd')?.textContent?.replace(/\s+/g, ' ').trim();

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function submit(el: HTMLElement) {
  el.querySelector('form')!.dispatchEvent(new Event('submit'));
}

describe('PurchaseEditor', () => {
  describe('starting a new trip', () => {
    it('asks only for what is needed, with no exchange rate while it is euros', async () => {
      const { el } = await setup(undefined);
      expect(field(el, 'Name')).toBeTruthy();
      expect(field(el, 'per €1')).toBeUndefined();
      expect(el.textContent).toContain('After you create the trip');
    });

    it('asks for the exchange rate once the invoice is in another currency', async () => {
      const { fixture, el } = await setup(undefined);
      const currency = field(el, 'Prices on the invoice')!;
      currency.value = 'TRY';
      currency.dispatchEvent(new Event('change'));
      await settle(fixture);
      expect(field(el, 'TRY per €1')).toBeTruthy();
    });

    it('will not save a foreign-currency trip without the rate that was actually used', async () => {
      const { fixture, purchases, el } = await setup(undefined);
      type(field(el, 'Name')!, 'Istanbul');
      const currency = field(el, 'Prices on the invoice')!;
      currency.value = 'USD';
      currency.dispatchEvent(new Event('change'));
      await settle(fixture);
      submit(el);
      await settle(fixture);
      expect(purchases.create).not.toHaveBeenCalled();
      expect(el.querySelector('.notice-error')?.textContent).toContain('exchange rate');
    });

    it('will not save without a name', async () => {
      const { fixture, purchases, el } = await setup(undefined);
      submit(el);
      await settle(fixture);
      expect(purchases.create).not.toHaveBeenCalled();
      expect(el.querySelector('.notice-error')?.textContent).toContain('Give the trip a name');
    });

    it('creates the trip, reading prices written with a comma, and moves on to adding items', async () => {
      const { fixture, purchases, navigate, el } = await setup(undefined);
      type(field(el, 'Name')!, '  Istanbul, October ');
      type(field(el, 'Trip costs')!, '198,50');
      const currency = field(el, 'Prices on the invoice')!;
      currency.value = 'TRY';
      currency.dispatchEvent(new Event('change'));
      await settle(fixture);
      type(field(el, 'TRY per €1')!, '38,5');
      const method = field(el, 'Share the trip costs')!;
      method.value = 'by_value';
      method.dispatchEvent(new Event('change'));
      await settle(fixture);

      submit(el);
      await settle(fixture);

      expect(purchases.create).toHaveBeenCalledWith(expect.objectContaining({
        reference: 'Istanbul, October', currency: 'TRY', currency_per_eur: 38.5, extra_costs_eur: 198.5, allocation_method: 'by_value', supplier_name: null,
      }));
      expect(navigate).toHaveBeenCalledWith(['/admin/stock/purchases', 42, 'add']);
    });

    it('keeps euros at exactly 1 per euro', async () => {
      const { fixture, purchases, el } = await setup(undefined);
      type(field(el, 'Name')!, 'Local');
      submit(el);
      await settle(fixture);
      expect(purchases.create).toHaveBeenCalledWith(expect.objectContaining({ currency: 'EUR', currency_per_eur: 1, extra_costs_eur: 0 }));
    });
  });

  describe('a draft with items', () => {
    // 50 at €10 and 30 at €30 on a trip that cost €400: the plan's own worked example.
    const eightyItems = [line(1, 50, 10), line(2, 30, 30)];

    it('shows what each item will really cost, before anything is received', async () => {
      const { el } = await setup('9', purchase(), eightyItems);
      const costs = [...el.querySelectorAll('.line .landed strong')].map((s) => s.textContent);
      expect(costs).toEqual(['€15.00', '€35.00']); // €10 + €5 and €30 + €5
    });

    it('adds up the whole trip', async () => {
      const { el } = await setup('9', purchase(), eightyItems);
      expect(sum(el, 'Items')).toBe('80');
      expect(sum(el, 'Goods')).toBe('€1,400.00');
      expect(sum(el, 'Trip costs')).toBe('€400.00');
      expect(sum(el, 'Everything')).toBe('€1,800.00');
      expect(sum(el, 'Per item, on average')).toBe('€22.50');
    });

    it('converts a foreign-currency invoice and says what it came to in euros', async () => {
      const { el } = await setup('9', purchase({ currency: 'TRY', currency_per_eur: 45, extra_costs_eur: 30 }), [line(1, 10, 900)]);
      expect(sum(el, 'Goods')).toContain('9,000.00 TRY');
      expect(sum(el, 'Goods')).toContain('≈ €200.00');
      expect(sum(el, 'Everything')).toBe('€230.00');
      expect(el.querySelector('.line .landed strong')!.textContent).toBe('€23.00');
    });

    it('spreads by price when asked, so dearer items carry more of the trip', async () => {
      const { el } = await setup('9', purchase({ allocation_method: 'by_value', extra_costs_eur: 60 }), [line(1, 10, 20), line(2, 10, 40)]);
      expect([...el.querySelectorAll('.line .landed strong')].map((s) => s.textContent)).toEqual(['€22.00', '€44.00']);
    });

    it('warns when new stock will change the average cost of what is already on the shelf', async () => {
      const { el } = await setup('9', purchase({ extra_costs_eur: 0 }), [line(1, 10, 24, {}, { qty_physical: 10 }, 20)]);
      expect(el.querySelector('.line .note')?.textContent).toContain('€20.00 → €22.00');
      expect(el.querySelector('.line .note')?.textContent).toContain('10 already on the shelf');
    });

    it('says nothing about averages when there is nothing on the shelf yet', async () => {
      const { el } = await setup('9', purchase(), eightyItems);
      expect(el.querySelector('.line .note')).toBeNull();
    });

    it('refuses to spread trip costs by price when everything is free', async () => {
      const { el } = await setup('9', purchase({ allocation_method: 'by_value', extra_costs_eur: 50 }), [line(1, 5, 0)]);
      expect(el.querySelector('.sum + .notice-error')?.textContent).toContain('Spread them equally');
      expect(button(el, /^Receive/)!.disabled).toBe(true);
    });

    it('cannot be received with no items', async () => {
      const { el } = await setup('9', purchase(), []);
      expect(button(el, 'Receive')!.disabled).toBe(true);
      expect(el.textContent).toContain('Nothing yet');
    });

    it('removes an item from the trip', async () => {
      const { fixture, purchases, el } = await setup('9', purchase(), eightyItems);
      el.querySelector<HTMLButtonElement>('.line .btn-danger')!.click();
      await settle(fixture);
      expect(purchases.removeLines).toHaveBeenCalledWith(9, [1]);
    });
  });

  describe('receiving', () => {
    it('asks first, then puts the goods on the shelf and offers to scan the tags', async () => {
      const { fixture, purchases, el } = await setup('9', purchase(), [line(1, 50, 10), line(2, 30, 30)]);
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      expect(button(el, 'Receive 80 items')!.disabled).toBe(false);

      button(el, 'Receive 80 items')!.click();
      await settle(fixture);

      expect(confirm.mock.calls[0][0]).toContain('80 items');
      expect(confirm.mock.calls[0][0]).toContain('can’t be undone');
      expect(purchases.receive).toHaveBeenCalledWith(9);
      expect(el.querySelector('.done')?.textContent).toContain('on the shelf');
      // The clothes come with barcodes on their tags: nothing to print.
      expect(el.querySelector('.done a[href^="/admin/labels"]')).toBeNull();
      button(el, 'Scan the tags')!.click();
      await settle(fixture);
      expect(el.querySelector('app-barcode-linker')).toBeTruthy();
    });

    it('does nothing if the question is answered no', async () => {
      const { fixture, purchases, el } = await setup('9', purchase(), [line(1, 5, 10)]);
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      button(el, /^Receive/)!.click();
      await settle(fixture);
      expect(purchases.receive).not.toHaveBeenCalled();
    });

    it('shows the reason beside the button if receiving fails', async () => {
      const { fixture, purchases, el } = await setup('9', purchase(), [line(1, 5, 10)]);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      purchases.receive.mockRejectedValue(new Error('Couldn’t receive the items.'));
      button(el, /^Receive/)!.click();
      await settle(fixture);
      expect(el.querySelector('.notice-error[role=alert]')?.textContent).toContain('Couldn’t receive');
      expect(el.querySelector('.done')).toBeNull();
    });

    it('will not receive while the header has unsaved changes, since the costs shown are for the saved version', async () => {
      const { fixture, el } = await setup('9', purchase(), [line(1, 5, 10)]);
      expect(button(el, /^Receive/)!.disabled).toBe(false);
      type(field(el, 'Trip costs')!, '999');
      await settle(fixture);
      expect(button(el, /^Receive/)!.disabled).toBe(true);
      expect(el.textContent).toContain('Save the changes at the top first');
    });

    it('saves header changes and then the costs reflect them', async () => {
      const { fixture, purchases, el } = await setup('9', purchase(), [line(1, 10, 10)]);
      expect(sum(el, 'Everything')).toBe('€500.00'); // 100 + 400
      purchases.get.mockResolvedValue(purchase({ extra_costs_eur: 100 }));
      type(field(el, 'Trip costs')!, '100');
      await settle(fixture);
      submit(el);
      await settle(fixture);
      expect(purchases.update).toHaveBeenCalledWith(9, expect.objectContaining({ extra_costs_eur: 100 }));
      expect(sum(el, 'Everything')).toBe('€200.00');
    });
  });

  describe('a received trip', () => {
    const done = purchase({ status: 'received', received_at: '2026-10-02T09:00:00Z' });
    const stored = [
      line(1, 50, 10, { unit_price_eur: 10, allocated_extra_eur: 5, unit_landed_cost_eur: 15 }),
      line(2, 30, 30, { unit_price_eur: 30, allocated_extra_eur: 5, unit_landed_cost_eur: 35 }),
    ];

    it('is a permanent record: no form, no way to receive again', async () => {
      const { el } = await setup('9', done, stored);
      expect(el.querySelector('form')).toBeNull();
      expect(el.querySelector('app-purchase-lines')).toBeNull();
      expect(button(el, /^Receive/)).toBeUndefined();
      expect(button(el, /Delete/)).toBeUndefined();
      expect(el.textContent).toContain('permanent record');
    });

    it('shows the costs that were stored, not a recalculation', async () => {
      const { el } = await setup('9', done, [line(1, 10, 10, { unit_landed_cost_eur: 99.99 })]);
      expect(el.querySelector('.line .landed strong')!.textContent).toBe('€99.99');
    });

    it('can still link the barcodes on the tags, with labels only for what has none', async () => {
      const { fixture, el } = await setup('9', done, [stored[0], line(2, 30, 30, { variant: { ...stored[1].variant, barcode: '8691234567890' } })]);
      expect(el.textContent).toContain('1 of 2 sizes done');
      expect(el.querySelector('a[href^="/admin/labels"]')).toBeNull();
      button(el, 'Scan the tags')!.click();
      await settle(fixture);
      expect(el.querySelector('app-barcode-linker')).toBeTruthy();
      expect(el.querySelector('a[href="/admin/labels?purchase=9"]')!.textContent).toContain('Print a label');
    });
  });

  describe('adding items', () => {
    it('sends each thing bought to the Add item form, and back to it to change one', async () => {
      const { el } = await setup('9', purchase(), [line(1, 5, 10)]);
      expect(el.querySelector('a[href="/admin/stock/purchases/9/add"]')!.textContent).toContain('Add item');
      expect(el.querySelector('a[href="/admin/stock/purchases/9/add?design=5"]')!.textContent).toContain('Change');
    });

    it('says what was just added and offers the next one', async () => {
      const { fixture, el } = await setup('9', purchase(), [line(1, 5, 10)]);
      fixture.componentRef.setInput('added', '5');
      fixture.componentRef.setInput('name', 'Wrap dress');
      await settle(fixture);
      expect(el.querySelector('.done')!.textContent).toContain('Added Wrap dress: 5 items');
      expect(el.querySelector('.done a')!.textContent).toContain('Add another item');
    });
  });

  describe('drafts', () => {
    it('can be deleted after asking', async () => {
      const { fixture, purchases, navigate, el } = await setup('9', purchase(), []);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      button(el, 'Delete this draft')!.click();
      await settle(fixture);
      expect(purchases.remove).toHaveBeenCalledWith(9);
      expect(navigate).not.toHaveBeenCalled(); // goes through navigateByUrl
    });
  });

  describe('missing trips', () => {
    it('says so rather than showing an empty form', async () => {
      const { el } = await setup('999', null);
      expect(el.textContent).toContain('Buying trip not found');
    });

    it('treats a garbage id as not found without asking the database', async () => {
      const { purchases, el } = await setup('abc');
      expect(purchases.get).not.toHaveBeenCalled();
      expect(el.textContent).toContain('Buying trip not found');
    });
  });
});
