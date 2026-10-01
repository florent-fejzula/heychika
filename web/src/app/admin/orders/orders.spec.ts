import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { OrderDetail as Detail, OrderSummary, Orders } from '../../core/orders';
import { OrderDetail } from './order-detail';
import { OrderList } from './order-list';

function summary(id: number, status: OrderSummary['status'], name: string): OrderSummary {
  return {
    id, order_number: `HC-2026-000${id}`, channel: 'online', status, payment_status: 'unpaid', country: 'MK', currency: 'MKD',
    total_in_currency: 3350, delivery_name: name, delivery_city: 'Skopje', created_at: '2026-09-30T10:00:00Z', lines: [{ qty: 2 }, { qty: 1 }],
  };
}

const detail: Detail = {
  id: 7, order_number: 'HC-2026-0007', channel: 'online', status: 'new', payment_status: 'unpaid', country: 'MK', currency: 'MKD',
  currency_per_eur: 61.5, subtotal_eur: 50, delivery_fee_eur: 4, total_eur: 54, total_in_currency: 3350, delivery_fee_in_currency: 250,
  delivery_name: 'Arta Krasniqi', delivery_phone: '+38970123456', delivery_city: 'Skopje', delivery_address: 'Ul. Makedonija 5',
  delivery_postal_code: '1000', customer_notes: 'call after 5', created_at: '2026-10-01T10:00:00Z',
  customer: { id: 1, first_name: 'Arta', last_name: 'Krasniqi', phone: '+38970123456', orders: [{ count: 3 }] },
  lines: [{
    id: 1, variant_id: 10, sku_snapshot: 'DR-001-BLK-M', product_name_snapshot: 'Wrap dress', color_snapshot: 'Black', size_snapshot: 'M',
    qty: 2, unit_price_eur: 25, unit_price_in_currency: 1550, line_total_eur: 50,
  }],
  history: [{ to_status: 'new', created_at: '2026-10-01T10:00:00Z' }],
};

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 3; i++) {
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }
}

function provide(orders: Partial<Record<keyof Orders, unknown>>) {
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Orders, useValue: orders }] });
}

describe('OrderList', () => {
  it('puts the orders waiting to be confirmed first', async () => {
    provide({ list: vi.fn().mockResolvedValue([summary(3, 'dispatched', 'Besa'), summary(2, 'new', 'Arta')]) });
    const fixture = TestBed.createComponent(OrderList);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect([...el.querySelectorAll('h2')].map((h) => h.textContent!.trim())).toEqual(['To confirm 1', 'Earlier']);
    const first = el.querySelector('.item')!;
    expect(first.textContent).toContain('Arta');
    expect(first.textContent).toContain('3,350 MKD');
    expect(first.textContent).toContain('3 items');
    expect(first.getAttribute('href')).toBe('/admin/orders/2');
  });

  it('explains what will appear here when there are no orders', async () => {
    provide({ list: vi.fn().mockResolvedValue([]) });
    const fixture = TestBed.createComponent(OrderList);
    await settle(fixture);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No orders yet');
  });
});

describe('OrderDetail', () => {
  async function open(order: Detail | null = detail) {
    provide({ get: vi.fn().mockResolvedValue(order) });
    const fixture = TestBed.createComponent(OrderDetail);
    fixture.componentRef.setInput('id', '7');
    await settle(fixture);
    return fixture.nativeElement as HTMLElement;
  }

  it('shows who to call, where it goes and what the courier collects', async () => {
    const el = await open();
    expect(el.querySelector('h1')?.textContent).toBe('HC-2026-0007');
    expect(el.querySelector('a[href="tel:+38970123456"]')).toBeTruthy();
    expect(el.querySelector('a[href="https://wa.me/38970123456"]')).toBeTruthy();
    expect(el.querySelector('address')?.textContent).toContain('Ul. Makedonija 5');
    expect(el.querySelector('address')?.textContent).toContain('1000 Skopje');
    expect(el.querySelector('.note')?.textContent).toContain('call after 5');
    expect(el.textContent).toContain('2 earlier orders');
    expect(el.querySelector('.lines')?.textContent).toContain('DR-001-BLK-M');
    expect(el.querySelector('.total')?.textContent).toContain('3,350 MKD');
    expect(el.textContent).toContain('€54.00 at 61.5 MKD');
  });

  it('copies name, phone and address in one go, for the courier', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const el = await open();
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes('Copy'))!.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('Arta Krasniqi\n+38970123456\nUl. Makedonija 5\n1000 Skopje\nNorth Macedonia');
  });

  it('says when there is no such order', async () => {
    const el = await open(null);
    expect(el.textContent).toContain('no such order');
  });
});
