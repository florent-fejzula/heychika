import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { PurchaseSummary, Purchases } from '../../core/purchases';
import { PurchaseList } from './purchase-list';

function trip(id: number, reference: string, status: 'draft' | 'received', over: Partial<PurchaseSummary> = {}): PurchaseSummary {
  return {
    id, reference, status, supplier_name: null, purchase_date: '2026-10-01', currency: 'EUR', currency_per_eur: 1, extra_costs_eur: 400,
    allocation_method: 'by_quantity', received_at: status === 'received' ? '2026-10-02T00:00:00Z' : null, notes: null,
    lines: [{ qty: 50, unit_price: 10 }, { qty: 30, unit_price: 30 }], ...over,
  };
}

async function setup(data: PurchaseSummary[] | Error) {
  const stub = { list: data instanceof Error ? vi.fn().mockRejectedValue(data) : vi.fn().mockResolvedValue(data) };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Purchases, useValue: stub }] });
  const fixture = TestBed.createComponent(PurchaseList);
  await settle(fixture);
  return { el: fixture.nativeElement as HTMLElement };
}

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 3; i++) {
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }
}

describe('PurchaseList', () => {
  it('separates trips not yet received from those that are', async () => {
    const { el } = await setup([trip(2, 'Istanbul, November', 'draft'), trip(1, 'Istanbul, October', 'received')]);
    const headings = [...el.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toEqual(['Not received yet', 'Received']);
    const items = [...el.querySelectorAll('.item')].map((i) => i.textContent!.replace(/\s+/g, ' '));
    expect(items[0]).toContain('Istanbul, November');
    expect(items[0]).toContain('Draft');
    expect(items[1]).toContain('Istanbul, October');
  });

  it('totals the items and goods on a received trip, in the invoice currency', async () => {
    const { el } = await setup([trip(1, 'Istanbul', 'received', { currency: 'TRY', lines: [{ qty: 10, unit_price: 900 }] })]);
    const text = el.querySelector('.item')!.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('10 items');
    expect(text).toContain('9,000.00 TRY');
    expect(text).toContain('+ €400.00 trip costs');
  });

  it('links each trip to its page', async () => {
    const { el } = await setup([trip(7, 'X', 'draft')]);
    expect(el.querySelector('a.item')!.getAttribute('href')).toBe('/admin/stock/purchases/7');
  });

  it('explains what a buying trip is when there are none', async () => {
    const { el } = await setup([]);
    expect(el.textContent).toContain('No buying trips yet');
    expect(el.querySelector('a[href="/admin/stock/purchases/new"]')).toBeTruthy();
  });

  it('shows a readable error when loading fails', async () => {
    const { el } = await setup(new Error('Couldn’t load the buying trips.'));
    expect(el.querySelector('.notice-error')?.textContent).toContain('Couldn’t load');
  });
});
