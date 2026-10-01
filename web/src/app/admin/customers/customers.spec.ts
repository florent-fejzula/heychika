import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { CustomerDetail as Detail, CustomerSummary, Orders } from '../../core/orders';
import { summary } from '../orders/order-fixtures';
import { CustomerDetail } from './customer-detail';
import { CustomerList } from './customer-list';

const base = { email: null, postal_code: null, notes: null, created_at: '2026-09-01', address: 'Street 1' };

const customers: CustomerSummary[] = [
  { ...base, id: 1, first_name: 'Arta', last_name: 'K', phone: '+38344123456', country: 'XK', city: 'Prishtina',
    orders: [
      { id: 1, status: 'completed', payment_status: 'paid', total_eur: 52, created_at: '2026-09-02' },
      { id: 2, status: 'returned', payment_status: 'unpaid', total_eur: 30, created_at: '2026-09-05' },
    ] },
  { ...base, id: 2, first_name: 'Besa', last_name: 'M', phone: '+38970222333', country: 'MK', city: 'Tetovo', orders: [] },
];

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 4; i++) {
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }
}

describe('CustomerList', () => {
  it('lists customers with what they’ve paid for, and flags parcels that came back', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Orders, useValue: { customers: vi.fn().mockResolvedValue(customers) } }] });
    const fixture = TestBed.createComponent(CustomerList);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const arta = el.querySelector('.item')!;
    expect(arta.textContent).toContain('2 orders');
    expect(arta.textContent).toContain('€52.00 paid');
    expect(arta.textContent).toContain('1 not delivered or returned');

    const search = el.querySelector<HTMLInputElement>('input[type=search]')!;
    search.value = '070 222';
    search.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect([...el.querySelectorAll('.item strong')].map((s) => s.textContent)).toEqual(['Besa M']);
  });
});

describe('CustomerDetail', () => {
  const detail: Detail = {
    ...customers[0],
    orders: [{ ...summary(1, 'completed', 'Arta', { payment_status: 'paid', currency: 'EUR', total_in_currency: 52 }), total_eur: 52 }],
  };

  async function open() {
    const orders = { customer: vi.fn().mockResolvedValue(detail), updateCustomer: vi.fn().mockResolvedValue(undefined) };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Orders, useValue: orders }] });
    const fixture = TestBed.createComponent(CustomerDetail);
    fixture.componentRef.setInput('id', '1');
    await settle(fixture);
    return { fixture, orders, el: fixture.nativeElement as HTMLElement };
  }

  it('shows her details and her orders', async () => {
    const { el } = await open();
    expect(el.querySelector('h1')?.textContent).toBe('Arta K');
    expect(el.querySelector('a[href="tel:+38344123456"]')).toBeTruthy();
    expect(el.querySelector('a[href="/admin/orders/1"]')?.textContent).toContain('€52.00');
  });

  it('edits her details, keeping a note about her', async () => {
    const { fixture, el, orders } = await open();
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === 'Edit')!.click();
    await settle(fixture);
    const notes = el.querySelector<HTMLTextAreaElement>('textarea')!;
    notes.value = 'size M, prefers WhatsApp';
    notes.dispatchEvent(new Event('input'));
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === 'Save')!.click();
    await settle(fixture);
    expect(orders.updateCustomer).toHaveBeenCalledWith(1, expect.objectContaining({ notes: 'size M, prefers WhatsApp', postal_code: null }));
    expect(el.textContent).toContain('Saved');
  });
});
