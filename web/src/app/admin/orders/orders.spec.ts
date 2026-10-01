import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { OrderDetail as Detail, Orders, stageOf } from '../../core/orders';
import { order, summary } from './order-fixtures';
import { OrderDetail } from './order-detail';
import { OrderList } from './order-list';

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 4; i++) {
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }
}

function provide(orders: Record<string, unknown>) {
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Orders, useValue: orders }] });
}

const button = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim().startsWith(text));

function type(el: HTMLElement, selector: string, value: string) {
  const input = el.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('stageOf', () => {
  it('sorts orders into the day’s work', () => {
    const s = (status: Detail['status'], payment_status: Detail['payment_status'] = 'unpaid') => stageOf({ status, payment_status });
    expect(s('new')).toBe('confirm');
    expect(s('confirmed')).toBe('send');
    expect(s('dispatched')).toBe('road');
    expect(s('delivery_failed')).toBe('road');
    expect(s('delivered')).toBe('cash');
    expect(s('partially_returned')).toBe('cash');
    expect(s('partially_returned', 'paid')).toBe('done');
    expect(s('completed', 'paid')).toBe('done');
    expect(s('cancelled')).toBe('closed');
    expect(s('returned')).toBe('closed');
  });
});

describe('OrderList', () => {
  async function open(rows = [summary(3, 'dispatched', 'Besa'), summary(2, 'new', 'Arta'), summary(4, 'confirmed', 'Dita')]) {
    provide({ list: vi.fn().mockResolvedValue(rows) });
    const fixture = TestBed.createComponent(OrderList);
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('opens on the first stage with work in it, with a count on each', async () => {
    const { el } = await open();
    expect(el.querySelector('.stage.on')?.textContent).toContain('To confirm');
    expect([...el.querySelectorAll('.stage')].map((s) => s.textContent!.replace(/\s+/g, ' ').trim()).slice(0, 3))
      .toEqual(['To confirm 1', 'To send 1', 'On the road 1']);
    expect([...el.querySelectorAll('.item strong')].map((s) => s.textContent)).toEqual(['Arta']);
    expect(el.querySelector('.item')?.getAttribute('href')).toBe('/admin/orders/2');
  });

  it('switches stage', async () => {
    const { fixture, el } = await open();
    button(el, 'On the road')!.click();
    await settle(fixture);
    expect([...el.querySelectorAll('.item strong')].map((s) => s.textContent)).toEqual(['Besa']);
  });

  it('searches every order by name, number or phone, whatever the stage', async () => {
    const { fixture, el } = await open();
    type(el, 'input[type=search]', 'besa');
    await settle(fixture);
    expect([...el.querySelectorAll('.item strong')].map((s) => s.textContent)).toEqual(['Besa']);
    expect(el.querySelector('.stages')).toBeNull();

    type(el, 'input[type=search]', '070 123 456');
    await settle(fixture);
    expect(el.querySelectorAll('.item').length).toBe(3);

    type(el, 'input[type=search]', 'HC-2026-0004');
    await settle(fixture);
    expect([...el.querySelectorAll('.item strong')].map((s) => s.textContent)).toEqual(['Dita']);
  });

  it('explains what will appear here when there are no orders, and offers to type one in', async () => {
    const { el } = await open([]);
    expect(el.textContent).toContain('No orders yet');
    expect(el.querySelector('a[href="/admin/orders/new"]')).toBeTruthy();
  });
});

describe('OrderDetail', () => {
  async function open(o: Detail | null = order(), extra: Record<string, unknown> = {}) {
    const orders = {
      get: vi.fn().mockResolvedValue(o),
      confirm: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      markDelivered: vi.fn().mockResolvedValue(undefined),
      recordPayment: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
      retry: vi.fn().mockResolvedValue(undefined),
      updateDetails: vi.fn().mockResolvedValue(undefined),
      ...extra,
    };
    provide(orders);
    const fixture = TestBed.createComponent(OrderDetail);
    fixture.componentRef.setInput('id', '7');
    await settle(fixture);
    return { fixture, orders, el: fixture.nativeElement as HTMLElement };
  }

  it('shows who to call, where it goes and what the courier collects', async () => {
    const { el } = await open();
    expect(el.querySelector('h1')?.textContent).toBe('HC-2026-0007');
    expect(el.querySelector('a[href="tel:+38970123456"]')).toBeTruthy();
    expect(el.querySelector('a[href="https://wa.me/38970123456"]')).toBeTruthy();
    expect(el.querySelector('address')?.textContent).toContain('1000 Skopje');
    expect(el.textContent).toContain('call after 5');
    expect(el.textContent).toContain('2 earlier orders');
    expect(el.querySelector('.total')?.textContent).toContain('4,900 MKD');
  });

  it('a new order: confirm it after calling, then the page shows it confirmed', async () => {
    const { fixture, el, orders } = await open();
    orders.get.mockResolvedValue(order({ status: 'confirmed' }));
    button(el, 'Confirm')!.click();
    await settle(fixture);
    expect(orders.confirm).toHaveBeenCalledWith(7);
    expect(el.querySelector('.notice-ok')?.textContent).toContain('Confirmed');
    expect(el.querySelector('a[href="/admin/orders/7/pack"]')).toBeTruthy();
  });

  it('cancelling needs a reason, and offers the usual ones', async () => {
    const { fixture, el, orders } = await open();
    button(el, 'Cancel order')!.click();
    await settle(fixture);
    button(el, 'Cancel the order')!.click();
    await settle(fixture);
    expect(orders.cancel).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Choose or type a reason');

    [...el.querySelectorAll<HTMLInputElement>('.chip input')][1].click();
    await settle(fixture);
    button(el, 'Cancel the order')!.click();
    await settle(fixture);
    expect(orders.cancel).toHaveBeenCalledWith(7, 'Couldn’t reach the customer');
  });

  it('delivered with the cash in: suggests the total, less anything handed back at the door', async () => {
    const { fixture, el, orders } = await open(order({ status: 'dispatched' }));
    button(el, 'Delivered')!.click();
    await settle(fixture);
    const amount = el.querySelector<HTMLInputElement>('.panel input[inputmode=decimal]')!;
    expect(amount.value).toBe('4900');

    // She refused the silk top.
    const top = [...el.querySelectorAll('.refuse li')].find((li) => li.textContent!.includes('Silk top'))!;
    top.querySelector<HTMLButtonElement>('[aria-label="One more"]')!.click();
    await settle(fixture);
    expect(amount.value).toBe('3350');

    button(el, 'Save')!.click();
    await settle(fixture);
    expect(orders.markDelivered).toHaveBeenCalledWith(7, [{ order_line_id: 2, qty: 1 }], 3350);
  });

  it('delivered, cash to come later', async () => {
    const { fixture, el, orders } = await open(order({ status: 'dispatched' }));
    button(el, 'Delivered')!.click();
    await settle(fixture);
    el.querySelector<HTMLInputElement>('.panel input[type=checkbox]')!.click();
    await settle(fixture);
    button(el, 'Save')!.click();
    await settle(fixture);
    expect(orders.markDelivered).toHaveBeenCalledWith(7, [], null);
  });

  it('won’t record cash that isn’t a number', async () => {
    const { fixture, el, orders } = await open(order({ status: 'delivered' }));
    button(el, 'Cash received')!.click();
    await settle(fixture);
    type(el, '.panel input', '1,550');
    button(el, 'Save')!.click();
    await settle(fixture);
    expect(orders.recordPayment).not.toHaveBeenCalled();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('like 1550');

    type(el, '.panel input', '4900');
    button(el, 'Save')!.click();
    await settle(fixture);
    expect(orders.recordPayment).toHaveBeenCalledWith(7, 4900);
  });

  it('not delivered, with a note; then the courier can try again', async () => {
    const { fixture, el, orders } = await open(order({ status: 'dispatched' }));
    button(el, 'Not delivered')!.click();
    await settle(fixture);
    type(el, '.panel input', 'no answer');
    button(el, 'Save')!.click();
    await settle(fixture);
    expect(orders.markFailed).toHaveBeenCalledWith(7, 'no answer');

    TestBed.resetTestingModule();
    const failed = await open(order({ status: 'delivery_failed' }));
    expect(failed.el.querySelector('a[href="/admin/orders/7/return"]')?.textContent).toContain('Parcel came back');
    button(failed.el, 'Courier is trying again')!.click();
    await settle(failed.fixture);
    expect(failed.orders.retry).toHaveBeenCalledWith(7, '');
  });

  it('shows the database’s reason when a step is refused', async () => {
    const { fixture, el } = await open(order(), { confirm: vi.fn().mockRejectedValue(new Error('This order has moved on since the page was opened.')) });
    button(el, 'Confirm')!.click();
    await settle(fixture);
    expect(el.querySelector('[role=alert]')?.textContent).toContain('moved on');
  });

  it('corrects the address, sending only what changed', async () => {
    const { fixture, el, orders } = await open();
    button(el, 'Edit')!.click();
    await settle(fixture);
    const inputs = [...el.querySelectorAll<HTMLInputElement>('section.card .field input')];
    const address = inputs[3];
    address.value = 'Ul. Partizanska 10';
    address.dispatchEvent(new Event('input'));
    button(el, 'Save')!.click();
    await settle(fixture);
    expect(orders.updateDetails).toHaveBeenCalledWith(7, { delivery_address: 'Ul. Partizanska 10' });
  });

  it('a finished order shows what came back, the profit, and offers another return', async () => {
    const done = order({
      status: 'partially_returned', payment_status: 'paid', amount_collected: 4900, locked: true,
      lines: [
        { ...order().lines[0], unit_cost_eur: 10, returned_qty: 1 },
        { ...order().lines[1], unit_cost_eur: 12 },
      ],
      returns: [{ id: 1, return_number: 'RT-2026-0001', reason: 'too small', refund_amount_currency: 1550, refund_method: 'cash', notes: null, created_at: '2026-10-03T10:00:00Z', lines: [{ order_line_id: 1, qty: 1, condition: 'saleable' }] }],
    });
    const { el } = await open(done);
    expect(el.textContent).toContain('RT-2026-0001');
    expect(el.textContent).toContain('1 × Wrap dress · Black M — back on the shelf');
    expect(el.textContent).toContain('Refunded 1,550 MKD by cash');
    expect(el.textContent).toContain('€22.00 · €28.00'); // cost 10 + 12; sold 25 + 25
    expect(el.querySelector('a[href="/admin/orders/7/return"]')).toBeTruthy();
    expect(el.textContent).not.toContain('Change items');
  });

  it('says when there is no such order', async () => {
    const { el } = await open(null);
    expect(el.textContent).toContain('no such order');
  });
});
