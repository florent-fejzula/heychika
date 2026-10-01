import { DOCUMENT, Injectable, PLATFORM_ID, REQUEST, TransferState, computed, inject, makeStateKey, signal } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { COUNTRY_CURRENCY, Country, DeliveryZone, FxSettings, formatMoney, localPrice } from '../core/money';
import { ShopContext } from './shop-api';

const COOKIE = 'hc_country';
const COUNTRY_KEY = makeStateKey<Country>('shop-country');
const COUNTRIES: Country[] = ['XK', 'MK', 'AL'];

// Used until the real settings arrive, and if they never do. Same as the database defaults.
const DEFAULT_FX: FxSettings = { mkd_per_eur: 61.5, all_per_eur: 98, mkd_rounding: 50, all_rounding: 100 };

function isCountry(value: unknown): value is Country {
  return COUNTRIES.includes(value as Country);
}

function readCookie(header: string | null | undefined): Country | null {
  const match = /(?:^|;\s*)hc_country=([A-Z]{2})/.exec(header ?? '');
  return match && isCountry(match[1]) ? match[1] : null;
}

/**
 * Where the customer is shopping from, which sets the currency every price is
 * shown in and the delivery fee. Remembered in a cookie (not local storage) so
 * the server can render prices in the right currency on the first byte.
 */
@Injectable({ providedIn: 'root' })
export class ShopState {
  private readonly document = inject(DOCUMENT);
  private readonly transfer = inject(TransferState);

  /** Settings, delivery zones and categories. Null until loaded, or if loading failed. */
  readonly context = signal<ShopContext | null>(null);
  readonly country = signal<Country>(this.initialCountry());

  readonly currency = computed(() => COUNTRY_CURRENCY[this.country()]);
  readonly fx = computed<FxSettings>(() => this.context()?.settings ?? DEFAULT_FX);
  readonly zone = computed<DeliveryZone | null>(() => this.context()?.zones.find((z) => z.country === this.country()) ?? null);
  readonly storeName = computed(() => this.context()?.settings.store_name ?? 'Hey Chika');

  /** A euro price as this customer sees it: converted and rounded up for MKD and ALL. */
  price(eur: number): string {
    return formatMoney(localPrice(eur, this.currency(), this.fx()), this.currency());
  }

  /** An amount already in the customer's currency. */
  money(amount: number): string {
    return formatMoney(amount, this.currency());
  }

  setCountry(country: Country): void {
    this.country.set(country);
    this.document.cookie = `${COOKIE}=${country}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  // On the server: the cookie, or a guess from the browser's language (Macedonian
  // speakers are almost certainly in North Macedonia; Albanian is spoken in both
  // Kosovo and Albania, so it can't decide). The browser then takes the server's
  // answer, so the page it hydrates shows the same prices.
  private initialCountry(): Country {
    if (isPlatformServer(inject(PLATFORM_ID))) {
      const request = inject(REQUEST, { optional: true });
      const chosen =
        readCookie(request?.headers.get('cookie')) ??
        (/^mk\b/i.test(request?.headers.get('accept-language') ?? '') ? 'MK' : 'XK');
      this.transfer.set(COUNTRY_KEY, chosen);
      return chosen;
    }
    return this.transfer.get(COUNTRY_KEY, null) ?? readCookie(this.document.cookie) ?? 'XK';
  }
}
