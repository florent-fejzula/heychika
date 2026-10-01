import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Orders } from '../../core/orders';
import { order } from './order-fixtures';
import { OrderPack } from './order-pack';

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 4; i++) {
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }
}

async function setup(o = order({ status: 'confirmed' })) {
  localStorage.clear();
  const orders = { get: vi.fn().mockResolvedValue(o), dispatch: vi.fn().mockResolvedValue(undefined) };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Orders, useValue: orders }] });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(OrderPack);
  fixture.componentRef.setInput('id', '7');
  await settle(fixture);
  return { fixture, orders, navigate, el: fixture.nativeElement as HTMLElement };
}

async function scan(fixture: ComponentFixture<unknown>, el: HTMLElement, code: string) {
  const input = el.querySelector<HTMLInputElement>('app-scanner input')!;
  input.value = code;
  input.dispatchEvent(new Event('input'));
  el.querySelector<HTMLFormElement>('app-scanner form')!.dispatchEvent(new Event('submit'));
  await settle(fixture);
}

const sendButton = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes('Mark as sent'))!;

describe('OrderPack', () => {
  it('ticks items off as they are scanned, and only then allows sending', async () => {
    const { fixture, el } = await setup();
    expect(el.querySelector('h2')?.textContent).toBe('0 of 3 packed');
    expect(sendButton(el).disabled).toBe(true);

    await scan(fixture, el, 'DR-001-BLK-M');
    expect(el.querySelector('.feedback.ok')?.textContent).toContain('Wrap dress, Black M (1 of 2)');
    await scan(fixture, el, 'dr-001-blk-m'); // a hand-typed code in lower case still counts
    await scan(fixture, el, 'DR-002-BLK-S');
    expect(el.querySelector('h2')?.textContent).toBe('3 of 3 packed');
    expect(sendButton(el).disabled).toBe(false);
  });

  it('shouts when the wrong item is scanned, and doesn’t count it', async () => {
    const { fixture, el } = await setup();
    await scan(fixture, el, 'DR-001-BLK-L');
    expect(el.querySelector('.feedback.wrong')?.textContent).toContain('DR-001-BLK-L is not in this order');
    expect(el.querySelector('h2')?.textContent).toBe('0 of 3 packed');
  });

  it('notices one too many of the same thing', async () => {
    const { fixture, el } = await setup();
    await scan(fixture, el, 'DR-002-BLK-S');
    await scan(fixture, el, 'DR-002-BLK-S');
    expect(el.querySelector('.feedback.warn')?.textContent).toContain('Already have this one');
    expect(el.querySelector('h2')?.textContent).toBe('1 of 3 packed');
  });

  it('sends with the courier and tracking number, remembers the courier, and goes back to the order', async () => {
    const { fixture, el, orders, navigate } = await setup();
    for (const code of ['DR-001-BLK-M', 'DR-001-BLK-M', 'DR-002-BLK-S']) await scan(fixture, el, code);
    const [courier, tracking] = [...el.querySelectorAll<HTMLInputElement>('.grid-2 input')];
    courier.value = 'Post Express';
    courier.dispatchEvent(new Event('input'));
    tracking.value = 'PE123';
    tracking.dispatchEvent(new Event('input'));
    sendButton(el).click();
    await settle(fixture);
    expect(orders.dispatch).toHaveBeenCalledWith(7, 'Post Express', 'PE123');
    expect(localStorage.getItem('hc_last_courier')).toBe('Post Express');
    expect(navigate).toHaveBeenCalledWith(['/admin/orders', 7]);
  });

  it('can tick an item by hand, or send without checking everything when asked to', async () => {
    const { fixture, el, orders } = await setup();
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === 'Tick')!.click();
    await settle(fixture);
    expect(el.querySelector('h2')?.textContent).toBe('1 of 3 packed');

    el.querySelector<HTMLInputElement>('.check input')!.click();
    await settle(fixture);
    sendButton(el).click();
    await settle(fixture);
    expect(orders.dispatch).toHaveBeenCalled();
  });

  it('won’t pack an order that has already left', async () => {
    const { el } = await setup(order({ status: 'dispatched' }));
    expect(el.textContent).toContain('already left');
    expect(el.querySelector('app-scanner')).toBeNull();
  });
});
