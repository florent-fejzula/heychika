import { PLATFORM_ID, TransferState, makeStateKey } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Supabase } from '../core/supabase';
import { ShopApi, ShopImage, pickImage, problemOf, slugify } from './shop-api';

// A stand-in for the Supabase query builder: every call chains, and awaiting it
// gives back whatever the test said the database returned.
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: [string, unknown[]][] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'single', 'overrideTypes']) {
    chain[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return chain;
    };
  }
  chain['then'] = (resolve: (r: unknown) => unknown) => resolve(result);
  const client = {
    from: vi.fn(() => chain),
    rpc: vi.fn(async () => result),
    storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn/${p}` } }) }) },
  };
  return { client, calls };
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, slug: 'wrap-dress-dr-001', name: 'Wrap dress', description: null, material: null, featured: false,
    created_at: '2026-10-01', status: 'active', show_online: true,
    category: { id: 1, name: 'Dresses', sort_order: 10 },
    variants: [
      { id: 11, price_eur: 30, compare_at_price_eur: null, active: true, color: { id: 2, name: 'Red', hex: '#c00', sort_order: 20 }, size: { id: 3, label: 'M', sort_order: 30 }, stock: { qty_available: 2 } },
      { id: 10, price_eur: 30, compare_at_price_eur: null, active: true, color: { id: 1, name: 'Black', hex: '#111', sort_order: 10 }, size: { id: 3, label: 'M', sort_order: 30 }, stock: [{ qty_available: -1 }] },
      { id: 12, price_eur: 30, compare_at_price_eur: null, active: false, color: { id: 1, name: 'Black', hex: '#111', sort_order: 10 }, size: { id: 2, label: 'S', sort_order: 20 }, stock: null },
    ],
    images: [
      { storage_path: '1/b.jpg', color_id: null, is_primary: false, sort_order: 0 },
      { storage_path: '1/a.jpg', color_id: null, is_primary: true, sort_order: 1 },
    ],
    ...overrides,
  };
}

function setup(result: { data: unknown; error: unknown }, platform: 'browser' | 'server' = 'browser') {
  const fake = fakeClient(result);
  TestBed.configureTestingModule({
    providers: [{ provide: Supabase, useValue: { client: fake.client } }, { provide: PLATFORM_ID, useValue: platform }],
  });
  return { api: TestBed.inject(ShopApi), ...fake };
}

describe('ShopApi', () => {
  it('lists what is for sale, with inactive sizes dropped, colours in order and the cover photo first', async () => {
    const { api } = setup({ data: [product()], error: null });
    const [p] = await api.products();
    expect(p.variants.map((v) => v.id)).toEqual([10, 11]); // Black before Red; inactive S gone
    expect(p.variants.map((v) => v.available)).toEqual([0, 2]); // a negative never shows
    expect(p.images.map((i) => i.storage_path)).toEqual(['1/a.jpg', '1/b.jpg']);
  });

  it('leaves out drafts even when an owner is signed in and the database would show them', async () => {
    const { api } = setup({ data: [product({ status: 'draft' }), product({ id: 2, show_online: false }), product({ id: 3 })], error: null });
    expect((await api.products()).map((p) => p.id)).toEqual([3]);
  });

  it('treats a design with no sizes for sale as not for sale', async () => {
    const { api } = setup({ data: product({ variants: [] }), error: null });
    expect(await api.product('wrap-dress-dr-001')).toBeNull();
  });

  it('hands what the server loaded to the browser, so the page is not fetched twice', async () => {
    const server = setup({ data: [product()], error: null }, 'server');
    await server.api.products();
    const state = TestBed.inject(TransferState);
    const key = makeStateKey<unknown>('shop-products');
    expect(state.hasKey(key)).toBe(true);
    const handed = state.toJson();

    TestBed.resetTestingModule();
    const browser = setup({ data: [], error: null });
    const transferred = TestBed.inject(TransferState);
    for (const [k, v] of Object.entries(JSON.parse(handed))) transferred.set(makeStateKey(k), v);

    expect((await browser.api.products()).length).toBe(1);
    expect(browser.client.from).not.toHaveBeenCalled();
    await browser.api.products(); // second visit loads fresh
    expect(browser.client.from).toHaveBeenCalledTimes(1);
  });

  it('turns tracking amounts into numbers', async () => {
    const { api } = setup({
      data: { order_number: 'HC-2026-0001', delivery_fee: '250', total: '3350', lines: [{ price: '1550', qty: 2 }] },
      error: null,
    });
    const o = await api.trackOrder('HC-2026-0001', '070123456');
    expect(o?.total).toBe(3350);
    expect(o?.delivery_fee).toBe(250);
    expect(o?.lines[0].price).toBe(1550);
  });

  it('sends checkout only ids and quantities, and reports why an order was refused', async () => {
    const { api, client } = setup({ data: null, error: { message: 'insufficient_stock', details: '11', hint: '1' } });
    await expect(
      api.placeOrder('MK', { first_name: 'A', last_name: 'B', phone: '070123456', city: 'Skopje', address: 'Street 1', postal_code: '' },
        [{ variant_id: 11, qty: 2 }], '', 3350),
    ).rejects.toMatchObject({ problem: { kind: 'sold_out', variantId: 11, available: 1 } });
    expect(client.rpc).toHaveBeenCalledWith('place_order', expect.objectContaining({
      p_country: 'MK', p_lines: [{ variant_id: 11, qty: 2 }], p_notes: null, p_expected_total: 3350,
    }));
  });
});

describe('problemOf', () => {
  it('reads each refusal the database can give', () => {
    expect(problemOf({ message: 'not_available', details: '12' })).toEqual({ kind: 'not_available', variantId: 12 });
    expect(problemOf({ message: 'price_changed', details: '3400' })).toEqual({ kind: 'price_changed', total: 3400 });
    expect(problemOf({ message: 'too_many_orders' })).toEqual({ kind: 'too_many_orders' });
    expect(problemOf({ message: 'invalid_order', details: 'phone' })).toEqual({ kind: 'invalid', field: 'phone' });
    expect(problemOf({ message: 'TypeError: Failed to fetch' })).toEqual({ kind: 'offline' });
    expect(problemOf({ message: 'something else' })).toEqual({ kind: 'unknown' });
  });
});

describe('pickImage', () => {
  const images: ShopImage[] = [
    { storage_path: 'cover.jpg', color_id: null, is_primary: true, sort_order: 0 },
    { storage_path: 'red.jpg', color_id: 2, is_primary: false, sort_order: 1 },
  ];

  it('prefers a photo of the chosen colour, then the cover', () => {
    expect(pickImage(images, 2)?.storage_path).toBe('red.jpg');
    expect(pickImage(images, 9)?.storage_path).toBe('cover.jpg');
    expect(pickImage([], 2)).toBeNull();
  });
});

describe('slugify', () => {
  it('makes names safe for links', () => {
    expect(slugify('T-Shirts')).toBe('t-shirts');
    expect(slugify('Çanta & Këpucë')).toBe('canta-kepuce');
  });
});
