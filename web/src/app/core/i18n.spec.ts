import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import en from '../../i18n/en.json';
import sq from '../../i18n/sq.json';
import { LangPicker } from '../shared/lang-picker';
import { I18n, LANG_COOKIE, TranslatePipe, acceptLanguages, pickLang, provideI18n, t } from './i18n';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === 'string' ? [prefix + k] : keys(v, `${prefix}${k}.`)));
}

function value(obj: object, key: string): string {
  return key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj) as string;
}

const placeholders = (text: string) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

describe('the translations', () => {
  it('have the same keys in English and Albanian, each with the same {{ placeholders }}', () => {
    expect(keys(sq)).toEqual(keys(en));
    for (const key of keys(en)) {
      expect(value(sq, key).trim(), key).not.toBe('');
      expect(placeholders(value(sq, key)), key).toEqual(placeholders(value(en, key)));
    }
  });
});

describe('choosing the language', () => {
  it('keeps the one picked in the menu', () => {
    expect(pickLang('hc_country=XK; lang=sq', ['en-US'])).toBe('sq');
    expect(pickLang('lang=en', ['sq-AL'])).toBe('en');
  });

  it('otherwise takes the first of ours the browser lists, else English', () => {
    expect(pickLang('', ['sq-AL', 'en'])).toBe('sq');
    expect(pickLang(null, ['de-DE', 'en-GB', 'sq'])).toBe('en');
    expect(pickLang(undefined, ['mk-MK'])).toBe('en');
    expect(pickLang('lang=fr', [])).toBe('en');
  });

  it('reads an Accept-Language header, most wanted first', () => {
    expect(acceptLanguages('en;q=0.5, sq-AL, sq;q=0.9')).toEqual(['sq-AL', 'sq', 'en']);
    expect(acceptLanguages('de, *;q=0')).toEqual(['de']);
    expect(acceptLanguages(null)).toEqual([]);
  });
});

@Component({
  imports: [TranslatePipe, LangPicker],
  template: `<app-lang-picker /><h1>{{ 'admin.shell.orders' | t }}</h1><p>{{ 'admin.dashboard.newOrders' | t: { count: n } }}</p>`,
})
class Host {
  n = 1;
}

describe('switching language', () => {
  beforeEach(() => {
    document.cookie = `${LANG_COOKIE}=; Path=/; Max-Age=0`;
    TestBed.configureTestingModule({ providers: [provideI18n()] });
  });

  afterEach(() => {
    document.cookie = `${LANG_COOKIE}=; Path=/; Max-Age=0`;
    document.documentElement.lang = 'en';
  });

  it('changes every word on screen at once, and remembers the choice', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('h1')!.textContent).toBe('Orders');
    expect(el.querySelector('p')!.textContent).toBe('1 new order');

    // The flag opens the menu; Shqip switches.
    el.querySelector<HTMLButtonElement>('app-lang-picker .current')!.click();
    await fixture.whenStable();
    const shqip = [...el.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')].find((b) => b.textContent!.includes('Shqip'))!;
    shqip.click();
    await vi.waitFor(() => expect(TestBed.inject(I18n).lang()).toBe('sq'));
    await fixture.whenStable();

    expect(el.querySelector('h1')!.textContent).toBe('Porositë');
    expect(el.querySelector('p')!.textContent).toBe('1 porosi e re');
    expect(document.documentElement.lang).toBe('sq');
    expect(document.cookie).toContain(`${LANG_COOKIE}=sq`);
    expect(el.querySelector('[role=menu]')).toBeNull();

    // Plurals follow the number.
    fixture.componentInstance.n = 3;
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(el.querySelector('p')!.textContent).toBe('3 porosi të reja');

    // Code outside components (error messages, report labels) follows too.
    expect(t('errors.offline')).toContain('Nuk u lidh dot');
  });

  it('formats dates in the language on screen', async () => {
    const i18n = TestBed.inject(I18n);
    await i18n.use('en');
    expect(i18n.date('2026-10-06', { day: 'numeric', month: 'long' })).toBe('6 October');
    await i18n.use('sq');
    expect(i18n.date('2026-10-06', { day: 'numeric', month: 'long' })).toBe('6 tetor');
  });
});
