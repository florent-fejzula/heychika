import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Purchases } from '../../core/purchases';
import { BarcodeLinker, LinkableSize } from './barcode-linker';

const sizes: LinkableSize[] = [
  { variantId: 1, design: 'Wrap dress', colour: 'Black', size: 'S', sku: 'DR-001-BLK-S', barcode: 'DR-001-BLK-S' },
  { variantId: 2, design: 'Wrap dress', colour: 'Black', size: 'M', sku: 'DR-001-BLK-M', barcode: '8691234567890' },
];

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 4; i++) {
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }
}

async function setup(linkBarcode = vi.fn().mockResolvedValue(undefined)) {
  TestBed.configureTestingModule({ providers: [{ provide: Purchases, useValue: { linkBarcode } }] });
  const fixture = TestBed.createComponent(BarcodeLinker);
  fixture.componentRef.setInput('sizes', sizes);
  const changed = vi.fn();
  fixture.componentInstance.changed.subscribe(changed);
  await settle(fixture);
  return { fixture, linkBarcode, changed, el: fixture.nativeElement as HTMLElement };
}

async function scan(fixture: ComponentFixture<unknown>, el: HTMLElement, code: string) {
  const input = el.querySelector<HTMLInputElement>('app-scanner input')!;
  input.value = code;
  input.dispatchEvent(new Event('input'));
  el.querySelector('app-scanner form')!.dispatchEvent(new Event('submit'));
  await settle(fixture);
}

describe('BarcodeLinker', () => {
  it('counts what is linked', async () => {
    const { el } = await setup();
    expect(el.querySelector('.progress')!.textContent).toContain('1 of 2');
  });

  it('asks which size a new tag belongs to, offering only the ones not linked yet, and links it', async () => {
    const { fixture, el, linkBarcode, changed } = await setup();
    await scan(fixture, el, '8690000000001');
    const options = [...el.querySelectorAll<HTMLButtonElement>('.options button')];
    expect(options.map((b) => b.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Wrap dress · Black S']);

    options[0].click();
    await settle(fixture);
    expect(linkBarcode).toHaveBeenCalledWith(1, '8690000000001');
    expect(changed).toHaveBeenCalled();
    expect(el.querySelector('.notice-ok')!.textContent).toContain('Linked');
  });

  it('recognises a tag that is already linked', async () => {
    const { fixture, el, linkBarcode } = await setup();
    await scan(fixture, el, '8691234567890');
    expect(el.querySelector('.notice-ok')!.textContent).toContain('Wrap dress, Black M, already linked');
    expect(el.querySelector('.pick')).toBeNull();
    expect(linkBarcode).not.toHaveBeenCalled();
  });

  it('says so when the barcode is already on another size', async () => {
    const { fixture, el } = await setup(vi.fn().mockRejectedValue(new Error('That barcode is already on TP-002-RED-L.')));
    await scan(fixture, el, '8690000000001');
    el.querySelector<HTMLButtonElement>('.options button')!.click();
    await settle(fixture);
    expect(el.querySelector('.notice-error')!.textContent).toContain('TP-002-RED-L');
  });

  it('can unlink a size', async () => {
    const { fixture, el, linkBarcode } = await setup();
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === 'Unlink')!.click();
    await settle(fixture);
    expect(linkBarcode).toHaveBeenCalledWith(2, null);
  });
});
