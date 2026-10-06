import {
  DOCUMENT,
  EnvironmentProviders,
  Injectable,
  PLATFORM_ID,
  Pipe,
  PipeTransform,
  REQUEST,
  TransferState,
  inject,
  isDevMode,
  makeStateKey,
  provideAppInitializer,
  signal,
} from '@angular/core';
import { TranslocoLoader, TranslocoService, provideTransloco } from '@jsverse/transloco';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';

/**
 * The shop and the admin in English or Albanian, switched on the spot.
 *
 * The words live in src/i18n/en.json and sq.json, one key per sentence, grouped
 * by screen. Transloco does the loading and the {{ name }} placeholders; this
 * file adds what it doesn't: remembering the choice, plurals, dates, and a pipe
 * that reacts to a switch without reloading.
 *
 * Plurals: "items" is the general form and "items_one" the singular. Pass the
 * number as `count` and the right one is picked: {{ 'x.items' | t: { count: n } }}.
 */

export type Lang = 'en' | 'sq';

export const LANGS: readonly { code: Lang; name: string; flag: string }[] = [
  { code: 'en', name: 'English', flag: 'flags/gb.svg' },
  { code: 'sq', name: 'Shqip', flag: 'flags/al.svg' },
];

/** The cookie that remembers the choice. A cookie, not localStorage, so the server renders in it too. */
export const LANG_COOKIE = 'lang';

type Params = Record<string, unknown>;

const LANG_KEY = makeStateKey<Lang>('lang');

/** Each language is its own file, fetched only when it's used. */
@Injectable({ providedIn: 'root' })
class Loader implements TranslocoLoader {
  getTranslation(lang: string) {
    return lang === 'sq'
      ? import('../../i18n/sq.json').then((m) => m.default)
      : import('../../i18n/en.json').then((m) => m.default);
  }
}

/** The language a request or browser asks for: the saved choice, else the first of ours it lists. */
export function pickLang(cookie: string | null | undefined, preferred: readonly string[]): Lang {
  const saved = cookie?.match(new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=(en|sq)(?:;|$)`))?.[1];
  if (saved) return saved as Lang;
  for (const tag of preferred) {
    const base = tag.trim().toLowerCase().split(/[-_;]/)[0];
    if (base === 'sq' || base === 'en') return base;
  }
  return 'en';
}

/** Turns an Accept-Language header into its languages, most wanted first. */
export function acceptLanguages(header: string | null | undefined): string[] {
  return (header ?? '')
    .split(',')
    .map((part) => {
      const [tag, ...rest] = part.trim().split(';');
      const q = rest.map((r) => r.trim()).find((r) => r.startsWith('q='));
      return { tag, q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((l) => l.tag && l.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((l) => l.tag);
}

// The browser's instance, for the plain functions below (error messages, report
// labels) that run outside any component. Those only ever run in the browser,
// where there is one language at a time; the server renders several requests at
// once, so anything it renders goes through the injected service instead.
let current: I18n | null = null;

@Injectable({ providedIn: 'root' })
export class I18n {
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);
  private readonly request = inject(REQUEST, { optional: true });
  private readonly transfer = inject(TransferState);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly active = signal<Lang>('en');
  /** The language on screen. Anything that reads it updates when it changes. */
  readonly lang = this.active.asReadonly();

  constructor() {
    current = this;
  }

  /**
   * Loads the starting language before the first page is drawn, so nothing
   * flashes in the other one. A page the server rendered tells the browser which
   * language it used, so the browser carries on in the same one.
   */
  async init(): Promise<void> {
    let lang: Lang = 'en';
    if (this.browser) {
      lang = this.transfer.get(LANG_KEY, null) ?? pickLang(this.document.cookie, this.document.defaultView?.navigator.languages ?? []);
    } else if (this.request) {
      lang = pickLang(this.request.headers.get('cookie'), acceptLanguages(this.request.headers.get('accept-language')));
      this.transfer.set(LANG_KEY, lang);
    }
    await this.show(lang);
  }

  /** Switches the whole app, and remembers it for next time. */
  async use(lang: Lang): Promise<void> {
    await this.show(lang);
    if (!this.browser) return;
    this.document.cookie = `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  t(key: string, params?: Params): string {
    const lang = this.active();
    const count = params?.['count'];
    if (count === 1 && this.transloco.getTranslation(lang)[`${key}_one`] !== undefined) key = `${key}_one`;
    return this.transloco.translate(key, params, lang);
  }

  /**
   * A name the owners typed (a category, colour or size): its Albanian name when
   * the screen is in Albanian and they filled one in, else the main one.
   */
  named(name: string, sq: string | null | undefined): string {
    return this.active() === 'sq' && sq?.trim() ? sq.trim() : name;
  }

  /** For dates and times. Numbers and money stay in one format whatever the language. */
  locale(): string {
    return this.active() === 'sq' ? 'sq' : 'en-GB';
  }

  date(value: string | Date, options: Intl.DateTimeFormatOptions): string {
    return new Date(value).toLocaleDateString(this.locale(), options);
  }

  dateTime(value: string | Date, options: Intl.DateTimeFormatOptions): string {
    return new Date(value).toLocaleString(this.locale(), options);
  }

  private async show(lang: Lang): Promise<void> {
    await firstValueFrom(this.transloco.load(lang));
    this.transloco.setActiveLang(lang);
    this.active.set(lang);
    this.document.documentElement.lang = lang;
  }
}

/** For code outside components (see `current` above). */
export function t(key: string, params?: Params): string {
  return current ? current.t(key, params) : key;
}

/** I18n.named, for code outside components. */
export function named(name: string, sq: string | null | undefined): string {
  return current ? current.named(name, sq) : name;
}

/** The date locale for code outside components. */
export function dateLocale(): string {
  return current ? current.locale() : 'en-GB';
}

/**
 * {{ 'shop.bag.title' | t }}, {{ 'shop.bag.items' | t: { count: n } }}.
 * Impure so it runs again when the language changes; it's a lookup in a map.
 */
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  transform(key: string, params?: Params): string {
    return this.i18n.t(key, params);
  }
}

/** {{ colour.name | named: colour.name_sq }}: see I18n.named. Impure for the same reason as `t`. */
@Pipe({ name: 'named', pure: false })
export class NamedPipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  transform(name: string, sq: string | null | undefined): string {
    return this.i18n.named(name, sq);
  }
}

export function provideI18n(): EnvironmentProviders[] {
  return [
    ...provideTransloco({
      config: {
        availableLangs: ['en', 'sq'],
        defaultLang: 'en',
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
        // Both files have the same keys (a test checks), so there's nothing to fall back to.
        missingHandler: { useFallbackTranslation: false, logMissingKey: true },
      },
      loader: Loader,
    }),
    provideAppInitializer(() => inject(I18n).init()),
  ];
}
