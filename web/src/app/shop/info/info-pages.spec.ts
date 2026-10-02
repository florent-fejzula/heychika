import { RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ShopContext, ShopPages } from '../shop-api';
import { ShopState } from '../shop-state';
import { AboutPage, DeliveryPage, NotFoundPage, paragraphs } from './info-pages';

const PAGES: ShopPages = {
  about_text: 'Two sisters in Prishtina.\n\nWe pick every piece.\nOne by one.',
  returns_text: 'Message us within 14 days.',
};

const CONTEXT: ShopContext = {
  settings: {
    store_name: 'Hey Chika', contact_phone: '+383 44 123 456', contact_email: 'hello@heychika.test',
    instagram_url: 'https://instagram.com/heychika', tiktok_url: null, facebook_url: null,
    mkd_per_eur: 61.5, all_per_eur: 98, mkd_rounding: 50, all_rounding: 100,
  },
  zones: [
    { country: 'AL', currency: 'ALL', fee_eur: 5, free_over_eur: null, est_days: '3–5 days' },
    { country: 'XK', currency: 'EUR', fee_eur: 2, free_over_eur: 50, est_days: '1–2 days' },
    { country: 'MK', currency: 'MKD', fee_eur: 0, free_over_eur: null, est_days: null },
  ],
  categories: [],
};

async function open<T>(component: new () => T, context: ShopContext | null = CONTEXT, pages: unknown = { ok: true, value: PAGES }) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  TestBed.inject(ShopState).context.set(context);
  const fixture = TestBed.createComponent(component);
  fixture.componentRef.setInput('pages', pages);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('paragraphs', () => {
  it('starts a new paragraph at a blank line, and keeps single line breaks', () => {
    expect(paragraphs(PAGES.about_text)).toEqual(['Two sisters in Prishtina.', 'We pick every piece.\nOne by one.']);
    expect(paragraphs('  \n\n ')).toEqual([]);
    expect(paragraphs(null)).toEqual([]);
  });
});

describe('AboutPage', () => {
  it('shows the owners’ words and every way to get in touch', async () => {
    const el = await open(AboutPage);
    expect([...el.querySelectorAll('article > p:not(.more)')].map((p) => p.textContent!.trim())).toEqual([
      'Two sisters in Prishtina.',
      'We pick every piece.\nOne by one.',
    ]);
    const links = [...el.querySelectorAll<HTMLAnchorElement>('.contact a')].map((a) => [a.textContent!.trim(), a.getAttribute('href')]);
    expect(links).toEqual([
      ['Instagram', 'https://instagram.com/heychika'],
      ['+383 44 123 456', 'tel:+383 44 123 456'],
      ['WhatsApp', 'https://wa.me/38344123456'],
      ['Viber', 'viber://chat?number=%2B38344123456'],
      ['hello@heychika.test', 'mailto:hello@heychika.test'],
    ]);
  });

  it('offers WhatsApp only when the number has its country code', async () => {
    const el = await open(AboutPage, { ...CONTEXT, settings: { ...CONTEXT.settings, contact_phone: '044 123 456' } });
    expect(el.textContent).toContain('044 123 456');
    expect(el.textContent).not.toContain('WhatsApp');
  });

  it('says so when the words can’t load', async () => {
    const el = await open(AboutPage, CONTEXT, { ok: false });
    expect(el.textContent).toContain('couldn’t load');
  });
});

describe('DeliveryPage', () => {
  it('lists each country with its fee in that country’s money, and the returns words', async () => {
    const el = await open(DeliveryPage);
    const rows = [...el.querySelectorAll('.zones tbody tr')].map((r) =>
      [...r.children].map((c) => c.textContent!.replace(/\s+/g, ' ').trim()).join(' | '),
    );
    expect(rows).toEqual([
      'Kosovo | €2.00 free over €50.00 | 1–2 days',
      'North Macedonia | Free | –',
      'Albania | 500 ALL | 3–5 days',
    ]);
    expect(el.textContent).toContain('in euros in Kosovo, in denars in North Macedonia and in lek in Albania');
    expect(el.textContent).toContain('Message us within 14 days.');
  });
});

describe('NotFoundPage', () => {
  it('tells the server to answer 404', async () => {
    const response: ResponseInit = {};
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: RESPONSE_INIT, useValue: response }] });
    const fixture = TestBed.createComponent(NotFoundPage);
    fixture.detectChanges();
    expect(response.status).toBe(404);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('This page isn’t here');
  });
});
