import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Catalogue, ScanResult } from '../../core/catalogue';
import { Scan } from './scan';

const found: ScanResult = {
  id: 1, sku: 'DR-001-BLK-M', barcode: 'DR-001-BLK-M', price_eur: 39, active: true,
  product: { id: 5, name: 'Black wrap dress', model_code: '001', status: 'active' },
  color: { name: 'Black', hex: '#111111' }, size: { label: 'M' },
  stock: { qty_physical: 8, qty_reserved: 2, qty_available: 6, qty_in_transit: 1, qty_damaged: 0 },
};

async function setup(result: ScanResult | null | Error) {
  const stub = {
    findVariant: result instanceof Error ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result),
  };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Catalogue, useValue: stub }] });
  const fixture = TestBed.createComponent(Scan);
  await settle(fixture);
  return { fixture, stub, el: fixture.nativeElement as HTMLElement };
}

async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable();
  await Promise.resolve();
  fixture.detectChanges();
  await fixture.whenStable();
}

async function scan(fixture: ComponentFixture<unknown>, el: HTMLElement, code: string) {
  const input = el.querySelector<HTMLInputElement>('form input')!;
  input.value = code;
  input.dispatchEvent(new Event('input'));
  await settle(fixture);
  el.querySelector('form')!.dispatchEvent(new Event('submit'));
  await settle(fixture);
}

describe('Scan', () => {
  it('shows the item and its stock levels when a code is found', async () => {
    const { fixture, stub, el } = await setup(found);
    await scan(fixture, el, ' DR-001-BLK-M ');

    expect(stub.findVariant).toHaveBeenCalledWith('DR-001-BLK-M'); // trimmed
    expect(el.querySelector('h2')?.textContent).toContain('Black wrap dress');
    expect(el.textContent).toContain('€39.00');

    const levels = [...el.querySelectorAll('.levels div')].map((d) => `${d.querySelector('dt')!.textContent} ${d.querySelector('dd')!.textContent}`);
    expect(levels).toEqual(['On the shelf 8', 'Reserved 2', 'Available 6', 'On the road 1', 'Damaged 0']);
  });

  it('says plainly when nothing matches, and clears any earlier result', async () => {
    const { fixture, stub, el } = await setup(found);
    await scan(fixture, el, 'DR-001-BLK-M');
    expect(el.querySelector('h2')).toBeTruthy();

    stub.findVariant.mockResolvedValue(null);
    await scan(fixture, el, 'NOPE-123');
    expect(el.textContent).toContain('Nothing found for');
    expect(el.textContent).toContain('NOPE-123');
    expect(el.querySelector('h2')).toBeNull();
  });

  it('ignores an empty scan', async () => {
    const { fixture, stub, el } = await setup(found);
    await scan(fixture, el, '   ');
    expect(stub.findVariant).not.toHaveBeenCalled();
  });

  it('warns when the item is switched off', async () => {
    const { fixture, el } = await setup({ ...found, active: false });
    await scan(fixture, el, 'DR-001-BLK-M');
    expect(el.textContent).toContain('marked inactive');
  });

  it('shows an error instead of failing silently when the lookup breaks', async () => {
    const { fixture, el } = await setup(new Error('Couldn’t look that up.'));
    await scan(fixture, el, 'DR-001-BLK-M');
    expect(el.querySelector('.notice-error')?.textContent).toContain('Couldn’t look that up.');
  });

  it('explains when the camera cannot be used', async () => {
    const { fixture, el } = await setup(found);
    const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    try {
      [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('camera'))!.click();
      await settle(fixture);
      expect(el.querySelector('.notice-error')?.textContent).toContain('secure (https)');
    } finally {
      if (original) Object.defineProperty(navigator, 'mediaDevices', original);
      else delete (navigator as unknown as Record<string, unknown>)['mediaDevices'];
    }
  });
});
