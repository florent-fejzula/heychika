import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import {
  OwedOrderRow, PurchaseReportRow, Reports, SaleOrderRow, StockReportRow,
  buyingReport, owedReport, periodFor, salesReport, stockReport,
} from '../../core/reports';
import { workbook } from '../../core/xlsx';
import { BuyingReport } from './buying-report';
import { buyingSheets, owedSheets, salesSheets, stockSheets } from './exports';
import { OwedReport } from './owed-report';
import { SalesReport } from './sales-report';
import { StockReport } from './stock-report';

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 4; i++) {
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }
}

const now = new Date().toISOString();

const sale: SaleOrderRow = {
  id: 1, order_number: 'HC-2026-0001', channel: 'online', country: 'MK', currency: 'MKD', currency_per_eur: 61.5,
  delivery_fee_eur: 4, amount_collected: 3350, paid_at: now, customer: { first_name: 'Arta', last_name: 'K' },
  lines: [
    {
      qty: 2, returned_qty: 0, refused_qty: 0, unit_price_eur: 25, unit_price_in_currency: 1550, unit_cost_eur: 10,
      sku_snapshot: 'DR-001-BLK-M', product_name_snapshot: 'Wrap dress', color_snapshot: 'Black', size_snapshot: 'M',
      variant: { product: { id: 1, name: 'Wrap dress', category: { name: 'Dresses' } } },
    },
  ],
  returns: [],
};

const unpaid: OwedOrderRow = {
  id: 9, order_number: 'HC-2026-0009', status: 'delivered', country: 'XK', currency: 'EUR', currency_per_eur: 1,
  total_in_currency: 52, dispatched_at: now, delivered_at: now, delivery_name: 'Besa M', delivery_phone: '+38344111222',
  delivery_city: 'Peja', courier_name: 'Post Express', lines: [],
};

const shelf: StockReportRow = {
  id: 1, sku: 'DR-001-BLK-M', active: true, price_eur: 30, cost_eur: 12,
  product: { id: 1, name: 'Wrap dress', status: 'active', category: { name: 'Dresses' } }, color: { name: 'Black' },
  size: { label: 'M', sort_order: 2 },
  stock: { qty_physical: 4, qty_reserved: 1, qty_available: 3, qty_in_transit: 1, qty_damaged: 0, min_stock: 0 },
};

const trip: PurchaseReportRow = {
  id: 3, reference: 'Istanbul Sept', supplier_name: 'Laleli Moda', purchase_date: '2026-09-10', currency: 'EUR', extra_costs_eur: 20,
  lines: [{ qty: 10, unit_price: 8, unit_price_eur: 8, allocated_extra_eur: 2, unit_landed_cost_eur: 10, variant: null }],
};

function setup<T>(component: Type<T>, reports: Partial<Record<keyof Reports, unknown>>) {
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Reports, useValue: reports }] });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(component);
  return { fixture, navigate, el: fixture.nativeElement as HTMLElement };
}

const tiles = (el: HTMLElement) => [...el.querySelectorAll('.tile')].map((t) => t.textContent!.replace(/\s+/g, ' ').trim());

describe('SalesReport', () => {
  it('shows this month’s sales, profit and cash, broken down by design', async () => {
    const reports = { sales: vi.fn().mockResolvedValue([sale]) };
    const { fixture, el } = setup(SalesReport, reports);
    await settle(fixture);

    expect(reports.sales).toHaveBeenCalledWith(periodFor('month'));
    expect(tiles(el)[0]).toContain('€50.41'); // 2 x 1550 MKD at 61.5
    expect(tiles(el)[1]).toContain('€30.41');
    expect(tiles(el)[2]).toContain('3,350 MKD');
    expect(el.querySelector('table')!.textContent).toContain('Wrap dress');
  });

  it('changes period through the address, so Back returns to the same view', async () => {
    const reports = { sales: vi.fn().mockResolvedValue([]) };
    const { fixture, el, navigate } = setup(SalesReport, reports);
    await settle(fixture);
    expect(el.textContent).toContain('No sales in this period');

    const chips = [...el.querySelectorAll<HTMLInputElement>('.chip input')];
    chips[1].click(); // Last month
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { period: 'last_month', from: null, to: null } }));

    fixture.componentRef.setInput('period', 'last_month');
    await settle(fixture);
    expect(reports.sales).toHaveBeenLastCalledWith(periodFor('last_month'));
  });

  it('takes chosen dates', async () => {
    const reports = { sales: vi.fn().mockResolvedValue([]) };
    const { fixture, el } = setup(SalesReport, reports);
    fixture.componentRef.setInput('period', 'custom');
    fixture.componentRef.setInput('from', '2026-03-01');
    fixture.componentRef.setInput('to', '2026-05-31');
    await settle(fixture);
    expect(reports.sales).toHaveBeenLastCalledWith({ from: '2026-03-01', to: '2026-05-31' });
    expect(el.querySelectorAll('input[type=date]').length).toBe(2);
    expect(el.textContent).toContain('1 Mar 2026 – 31 May 2026');
  });

  it('downloads the report as an Excel file named for the period', async () => {
    const { fixture, el } = setup(SalesReport, { sales: vi.fn().mockResolvedValue([sale]) });
    await settle(fixture);
    const createObjectURL = vi.fn(() => 'blob:report');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toMatch(/^hey-chika-sales-\d{4}-\d{2}-01_\d{4}-\d{2}-\d{2}\.xlsx$/);
    });

    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes('Excel'))!.click();
    expect(click).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    click.mockRestore();
  });

  it('says so when the sales can’t load', async () => {
    const { fixture, el } = setup(SalesReport, { sales: vi.fn().mockRejectedValue(new Error('Couldn’t load the sales.')) });
    await settle(fixture);
    expect(el.querySelector('.notice-error')!.textContent).toContain('Couldn’t load the sales.');
  });
});

describe('OwedReport', () => {
  it('shows what couriers owe, with the order to chase', async () => {
    const { fixture, el } = setup(OwedReport, { owed: vi.fn().mockResolvedValue({ orders: [unpaid], handedBack: [] }) });
    await settle(fixture);
    expect(tiles(el)[0]).toContain('€52.00');
    const link = el.querySelector<HTMLAnchorElement>('a.owed')!;
    expect(link.textContent).toContain('Besa M');
    expect(link.textContent).toContain('delivered today');
    expect(link.getAttribute('href')).toBe('/admin/orders/9');
    expect(el.textContent).toContain('Nothing is on its way back.');
  });
});

describe('StockReport', () => {
  it('values the shelf at cost and at price', async () => {
    const { fixture, el } = setup(StockReport, { stock: vi.fn().mockResolvedValue([shelf]) });
    await settle(fixture);
    expect(tiles(el)[0]).toContain('€48.00');
    expect(tiles(el)[1]).toContain('€120.00');
    expect(tiles(el)[2]).toContain('1');
  });
});

describe('BuyingReport', () => {
  it('shows this year’s trips, linked to each trip', async () => {
    const reports = { buying: vi.fn().mockResolvedValue([trip]) };
    const { fixture, el } = setup(BuyingReport, reports);
    await settle(fixture);
    expect(reports.buying).toHaveBeenCalledWith(periodFor('year'));
    expect(tiles(el)[0]).toContain('€100.00');
    expect(el.querySelector('table a')!.getAttribute('href')).toBe('/admin/stock/purchases/3');
  });
});

describe('Excel exports', () => {
  it('build a workbook for every report', () => {
    const period = periodFor('month');
    const books = [
      salesSheets(salesReport([sale]), period),
      owedSheets(owedReport([unpaid], [])),
      stockSheets(stockReport([shelf])),
      buyingSheets(buyingReport([trip])),
    ];
    expect(books.map((sheets) => sheets.map((s) => s.name))).toEqual([
      ['Summary', 'By design', 'By category', 'By country', 'Shop or DM', 'By month', 'Orders', 'Items sold'],
      ['Courier owes', 'Out for delivery', 'Coming back'],
      ['Summary', 'By category', 'By design', 'Every size'],
      ['Trips', 'By supplier', 'Items bought'],
    ]);
    for (const sheets of books) {
      for (const s of sheets) {
        for (const row of [...s.rows, ...(s.totals ? [s.totals] : [])]) expect(row.length).toBe(s.columns.length);
      }
      expect(workbook(sheets).length).toBeGreaterThan(1000);
    }
  });
});
