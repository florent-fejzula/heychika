import { PLATFORM_ID, REQUEST, TransferState, makeStateKey } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ShopState } from './shop-state';

function onServer(headers: Record<string, string>) {
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: 'server' },
      { provide: REQUEST, useValue: new Request('http://localhost/', { headers }) },
    ],
  });
  return TestBed.inject(ShopState);
}

describe('ShopState', () => {
  beforeEach(() => {
    document.cookie = 'hc_country=; Max-Age=0; Path=/';
  });

  it('shows prices in the chosen country’s currency, rounded up', () => {
    const shop = TestBed.inject(ShopState);
    expect(shop.price(25)).toBe('€25.00');
    shop.setCountry('MK');
    expect(shop.price(25)).toBe('1,550 MKD');
    shop.setCountry('AL');
    expect(shop.price(25)).toBe('2,500 ALL');
  });

  it('remembers the country in a cookie, so the server can render the right prices next time', () => {
    TestBed.inject(ShopState).setCountry('AL');
    expect(document.cookie).toContain('hc_country=AL');
    TestBed.resetTestingModule();
    expect(TestBed.inject(ShopState).country()).toBe('AL');
  });

  it('on the server, uses the cookie, else guesses Macedonia from a Macedonian browser, else Kosovo', () => {
    expect(onServer({ cookie: 'x=1; hc_country=AL' }).country()).toBe('AL');
    TestBed.resetTestingModule();
    expect(onServer({ 'accept-language': 'mk-MK,mk;q=0.9,en;q=0.8' }).country()).toBe('MK');
    TestBed.resetTestingModule();
    expect(onServer({ 'accept-language': 'sq-XK,sq;q=0.9' }).country()).toBe('XK');
    TestBed.resetTestingModule();
    expect(onServer({ cookie: 'hc_country=FR' }).country()).toBe('XK');
  });

  it('in the browser, takes the server’s choice, so the page it hydrates shows the same prices', () => {
    document.cookie = 'hc_country=AL; Path=/';
    TestBed.inject(TransferState).set(makeStateKey<string>('shop-country'), 'MK');
    expect(TestBed.inject(ShopState).country()).toBe('MK');
  });
});
