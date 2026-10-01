import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { OrderDetail, Orders } from '../../core/orders';
import { line, order } from './order-fixtures';
import { OrderReturn } from './order-return';

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 4; i++) {
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }
}

async function setup(o: OrderDetail) {
  const orders = { get: vi.fn().mockResolvedValue(o), recordReturn: vi.fn().mockResolvedValue('RT-2026-0001') };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Orders, useValue: orders }] });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(OrderReturn);
  fixture.componentRef.setInput('id', '7');
  await settle(fixture);
  return { fixture, orders, navigate, el: fixture.nativeElement as HTMLElement };
}

const save = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes('back'))!;
const row = (el: HTMLElement, name: string) => [...el.querySelectorAll<HTMLLIElement>('.lines > li')].find((li) => li.textContent!.includes(name))!;

describe('OrderReturn', () => {
  it('a parcel that never arrived comes back whole: everything ticked, reason filled, nothing to refund', async () => {
    const { fixture, el, orders, navigate } = await setup(order({ status: 'delivery_failed' }));
    expect(save(el).textContent).toContain('Record 3 items back');
    expect(el.querySelector<HTMLInputElement>('.field input')!.value).toBe('Couldn’t be delivered');
    expect(el.textContent).toContain('nothing to refund');

    // The silk top came back stained.
    row(el, 'Silk top').querySelectorAll<HTMLInputElement>('.chip input')[1].click();
    await settle(fixture);
    save(el).click();
    await settle(fixture);
    expect(orders.recordReturn).toHaveBeenCalledWith(7, [
      { order_line_id: 1, qty: 2, condition: 'saleable' },
      { order_line_id: 2, qty: 1, condition: 'damaged' },
    ], 'Couldn’t be delivered', 0, '', '');
    expect(navigate).toHaveBeenCalledWith(['/admin/orders', 7]);
  });

  it('starts from what was handed back at the door, with no refund (it was never paid for)', async () => {
    const o = order({
      status: 'completed', payment_status: 'paid', amount_collected: 3350,
      lines: [line(1, 'Wrap dress', 'M', 2), line(2, 'Silk top', 'S', 1, { refused_qty: 1 })],
    });
    const { el } = await setup(o);
    expect(save(el).textContent).toContain('Record 1 item back');
    expect(el.querySelector<HTMLInputElement>('.field input')!.value).toBe('Refused at the door');
    expect(el.querySelector<HTMLInputElement>('input[inputmode=decimal]')!.value).toBe('0');
  });

  it('something sent back after delivery: suggests refunding what it cost', async () => {
    const { fixture, el, orders } = await setup(order({ status: 'completed', payment_status: 'paid', amount_collected: 4900 }));
    expect(save(el).disabled).toBe(true);
    row(el, 'Wrap dress').querySelector<HTMLButtonElement>('[aria-label="One more"]')!.click();
    await settle(fixture);
    expect(el.querySelector<HTMLInputElement>('input[inputmode=decimal]')!.value).toBe('1550');

    save(el).click();
    await settle(fixture);
    expect(orders.recordReturn).not.toHaveBeenCalled();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Say why');

    [...el.querySelectorAll<HTMLInputElement>('input[name=reason]')].find((i) => i.parentElement!.textContent!.includes('Wrong size'))!.click();
    await settle(fixture);
    save(el).click();
    await settle(fixture);
    expect(orders.recordReturn).toHaveBeenCalledWith(7, [{ order_line_id: 1, qty: 1, condition: 'saleable' }], 'Wrong size', 1550, 'cash', '');
  });

  it('won’t take back more than was sent', async () => {
    const { fixture, el } = await setup(order({ status: 'delivered' }));
    const plus = row(el, 'Silk top').querySelector<HTMLButtonElement>('[aria-label="One more"]')!;
    plus.click();
    plus.click();
    await settle(fixture);
    expect(save(el).textContent).toContain('Record 1 item back');
  });

  it('says so when nothing can come back', async () => {
    const { el } = await setup(order({ status: 'confirmed' }));
    expect(el.textContent).toContain('Nothing on this order can come back');
  });
});
