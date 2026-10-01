import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Customer, OrderDetail, Orders } from '../../core/orders';
import { OrderEditor } from './order-editor';
import { PRICING, line, order, sellable } from './order-fixtures';

// Wrap dress in Black S (3 left) and Black M (1 left); Silk top in Cream S (none left).
const catalogue = [
  sellable(11, 'Wrap dress', 'Black', 'S', 3),
  sellable(12, 'Wrap dress', 'Black', 'M', 1),
  sellable(21, 'Silk top', 'Cream', 'S', 0, 39),
];

const arta: Customer = {
  id: 5, first_name: 'Arta', last_name: 'K', phone: '+38344123456', email: null, country: 'XK', city: 'Prishtina',
  address: 'Rr. Agim Ramadani 1', postal_code: null, notes: null, created_at: '2026-09-01',
};

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 4; i++) {
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }
}

async function setup(id?: string, existing: OrderDetail | null = null) {
  const orders = {
    pricing: vi.fn().mockResolvedValue(PRICING),
    sellable: vi.fn().mockResolvedValue(catalogue),
    get: vi.fn().mockResolvedValue(existing),
    findByPhone: vi.fn().mockResolvedValue([arta]),
    createManual: vi.fn().mockResolvedValue({ id: 42, order_number: 'HC-2026-0042' }),
    editItems: vi.fn().mockResolvedValue(undefined),
  };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Orders, useValue: orders }] });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(OrderEditor);
  if (id) fixture.componentRef.setInput('id', id);
  await settle(fixture);
  return { fixture, orders, navigate, el: fixture.nativeElement as HTMLElement };
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

const field = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLLabelElement>('label.field')].find((l) => l.textContent!.trim().startsWith(label))!.querySelector('input')!;
const button = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes(text))!;

async function addSize(fixture: ComponentFixture<unknown>, el: HTMLElement, search: string, size: string) {
  type(el.querySelector<HTMLInputElement>('input[type=search]')!, search);
  await settle(fixture);
  button(el, `· ${size}`).click();
  await settle(fixture);
}

describe('OrderEditor: a new order from a DM', () => {
  afterEach(() => vi.useRealTimers());

  it('finds a repeat customer by phone and fills in her details', async () => {
    const { fixture, el, orders } = await setup();
    vi.useFakeTimers();
    type(field(el, 'Phone'), '044 123');
    await vi.advanceTimersByTimeAsync(400);
    vi.useRealTimers();
    await settle(fixture);
    expect(orders.findByPhone).toHaveBeenCalledWith('044 123');

    el.querySelector<HTMLButtonElement>('.match')!.click();
    await settle(fixture);
    expect(field(el, 'Town or city').value).toBe('Prishtina');
    expect(el.textContent).toContain('Repeat customer');
  });

  it('adds sizes from a search, shows how many are left, and won’t add what’s gone', async () => {
    const { fixture, el } = await setup();
    await addSize(fixture, el, 'wrap', 'M');
    expect(el.querySelector('.lines')?.textContent).toContain('Black · M');
    expect(button(el, '· M').disabled).toBe(true); // the last one is now on this order

    type(el.querySelector<HTMLInputElement>('input[type=search]')!, 'silk');
    await settle(fixture);
    expect(button(el, '· S').disabled).toBe(true);
    expect(button(el, '· S').textContent).toContain('none left');
  });

  it('adds by scanning a sticker', async () => {
    const { fixture, el } = await setup();
    button(el, 'Add by scanning').click();
    await settle(fixture);
    const input = el.querySelector<HTMLInputElement>('app-scanner input')!;
    type(input, 'DR-011-BLA-S');
    el.querySelector('app-scanner form')!.dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(el.textContent).toContain('Added Wrap dress, Black S');
    expect(el.querySelectorAll('.lines li').length).toBe(1);
  });

  it('creates the order with the price agreed in the DM, in her currency, and opens it', async () => {
    const { fixture, el, orders, navigate } = await setup();
    [...el.querySelectorAll<HTMLInputElement>('.chip input')][1].click(); // North Macedonia
    type(field(el, 'Phone'), '070 222 333');
    type(field(el, 'First name'), 'Besa');
    type(field(el, 'Town or city'), 'Tetovo');
    type(field(el, 'Street and number'), 'Ilindenska 5');
    await addSize(fixture, el, 'wrap', 'S');
    await addSize(fixture, el, 'wrap', 'S');
    type(field(el, 'Price each'), '1400');
    await settle(fixture);
    // 2 x 1400 + 250 delivery
    expect(el.querySelector('.total dd')?.textContent).toBe('3,050 MKD');

    button(el, 'Create order').click();
    await settle(fixture);
    expect(orders.createManual).toHaveBeenCalledWith(
      'MK',
      { first_name: 'Besa', last_name: '', phone: '070 222 333', city: 'Tetovo', address: 'Ilindenska 5', postal_code: '' },
      [{ variant_id: 11, qty: 2, price: 1400 }],
      null,
      '',
    );
    expect(navigate).toHaveBeenCalledWith(['/admin/orders', 42]);
  });

  it('can give free delivery, and asks for what’s missing', async () => {
    const { fixture, el, orders } = await setup();
    await addSize(fixture, el, 'wrap', 'S');
    type(field(el, 'Delivery'), '0');
    await settle(fixture);
    expect(el.textContent).toContain('Free');

    button(el, 'Create order').click();
    await settle(fixture);
    expect(orders.createManual).not.toHaveBeenCalled();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Fill in the name');
  });
});

describe('OrderEditor: changing an order’s items', () => {
  const existing = order({ status: 'confirmed', lines: [line(1, 'Wrap dress', 'M', 1, { variant_id: 12 })] });

  it('starts from what the order has, counts its own items as available, and keeps its prices', async () => {
    const { fixture, el, orders, navigate } = await setup('7', existing);
    expect(el.querySelector('h1')?.textContent).toBe('Change items');
    expect(el.querySelector('.lines')?.textContent).toContain('Black · M');
    expect(field(el, 'Delivery').value).toBe('250');
    expect([...el.querySelectorAll('h2')].map((h) => h.textContent)).not.toContain('Customer');

    await addSize(fixture, el, 'wrap', 'S');
    button(el, 'Save changes').click();
    await settle(fixture);
    expect(orders.editItems).toHaveBeenCalledWith(7, [
      { variant_id: 12, qty: 1, price: null },
      { variant_id: 11, qty: 1, price: null },
    ], 250);
    expect(navigate).toHaveBeenCalledWith(['/admin/orders', 7]);
  });

  it('won’t change an order that has already been sent', async () => {
    const { el } = await setup('7', order({ status: 'dispatched' }));
    expect(el.textContent).toContain('can’t change');
  });
});
