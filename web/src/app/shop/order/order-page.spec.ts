import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ShopApi, TrackedOrder } from '../shop-api';
import { rememberOrder } from './last-order';
import { OrderPage } from './order-page';

const order: TrackedOrder = {
  order_number: 'HC-2026-0007', status: 'dispatched', created_at: '2026-10-01T10:00:00Z', dispatched_at: null, delivered_at: null,
  country: 'MK', currency: 'MKD', city: 'Skopje', first_name: 'Arta', delivery_fee: 250, total: 3350,
  lines: [{ name: 'Wrap dress', color: 'Black', size: 'M', qty: 2, price: 1550 }],
};

async function setup(number?: string, found: TrackedOrder | null = order) {
  const api = { trackOrder: vi.fn().mockResolvedValue(found) };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: ShopApi, useValue: api }] });
  const fixture = TestBed.createComponent(OrderPage);
  if (number) fixture.componentRef.setInput('number', number);
  await settle(fixture);
  return { fixture, api, el: fixture.nativeElement as HTMLElement };
}

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 3; i++) {
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }
}

function type(el: HTMLElement, name: string, value: string) {
  const input = el.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('OrderPage', () => {
  beforeEach(() => sessionStorage.clear());

  it('thanks her straight after checkout, without asking for the phone again', async () => {
    rememberOrder({ number: 'HC-2026-0007', phone: '070 123 456', name: 'Arta' });
    const { el, api } = await setup('HC-2026-0007', { ...order, status: 'new' });
    expect(api.trackOrder).toHaveBeenCalledWith('HC-2026-0007', '070 123 456');
    expect(el.querySelector('h1')?.textContent).toBe('Thank you, Arta!');
    expect(el.textContent).toContain('HC-2026-0007');
    expect(el.querySelector('.pay')?.textContent).toContain('3,350 MKD');
    expect(el.querySelector('.summary')?.textContent).toContain('3,100 MKD'); // 2 x 1550
  });

  it('still thanks her if the details can’t be fetched', async () => {
    rememberOrder({ number: 'HC-2026-0007', phone: '070 123 456', name: 'Arta' });
    const { el } = await setup('HC-2026-0007', null);
    expect(el.querySelector('h1')?.textContent).toBe('Thank you, Arta!');
  });

  it('asks for the phone when opened from anywhere else, then shows where the order is', async () => {
    const { fixture, el, api } = await setup('HC-2026-0007');
    expect(api.trackOrder).not.toHaveBeenCalled();
    expect(el.querySelector<HTMLInputElement>('input[name=number]')!.value).toBe('HC-2026-0007');

    type(el, 'phone', '070123456');
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await settle(fixture);
    expect(el.querySelector('h1')?.textContent).toBe('Order HC-2026-0007');
    expect([...el.querySelectorAll('.steps li.done')].map((s) => s.textContent)).toEqual(['Received', 'Confirmed', 'On its way']);
    expect(el.querySelector('.status')?.textContent).toContain('with the courier');
  });

  it('says when nothing matches', async () => {
    const { fixture, el } = await setup(undefined, null);
    type(el, 'number', 'HC-2026-9999');
    type(el, 'phone', '070123456');
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await settle(fixture);
    expect(el.querySelector('[role=alert]')?.textContent).toContain('No order matches');
  });

  it('explains a cancelled order in words instead of steps', async () => {
    rememberOrder({ number: 'HC-2026-0007', phone: '070', name: 'Arta' });
    sessionStorage.clear();
    const { fixture, el } = await setup(undefined, { ...order, status: 'cancelled' });
    type(el, 'number', 'HC-2026-0007');
    type(el, 'phone', '070123456');
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await settle(fixture);
    expect(el.querySelector('.steps')).toBeNull();
    expect(el.querySelector('.status')?.textContent).toBe('This order was cancelled.');
  });
});
