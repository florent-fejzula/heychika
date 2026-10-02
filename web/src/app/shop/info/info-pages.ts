import { Component, RESPONSE_INIT, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { COUNTRY_NAME, Currency, formatMoney, localPrice } from '../../core/money';
import { Loaded } from '../resolvers';
import { ShopPages } from '../shop-api';
import { ShopState } from '../shop-state';

// The shop's plain pages: About us, Delivery & returns, and Not found.
// The words come from Settings, so the owners can change them without a developer.

/** Plain text from Settings to paragraphs: a blank line starts a new one. */
export function paragraphs(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const CURRENCY_WORD: Record<Currency, string> = { EUR: 'euros', MKD: 'denars', ALL: 'lek' };

@Component({
  selector: 'app-about-page',
  imports: [RouterLink],
  templateUrl: './about-page.html',
  styleUrl: './info.scss',
})
export class AboutPage {
  protected readonly shop = inject(ShopState);
  readonly pages = input.required<Loaded<ShopPages>>();

  protected readonly text = computed(() => {
    const p = this.pages();
    return p.ok ? paragraphs(p.value.about_text) : null;
  });

  protected readonly contact = computed(() => {
    const s = this.shop.context()?.settings;
    if (!s) return null;
    // WhatsApp and Viber links need the number with its country code.
    const international = /^\s*(\+|00)/.test(s.contact_phone ?? '');
    const digits = (s.contact_phone ?? '').replace(/\D/g, '').replace(/^00/, '');
    return {
      instagram: s.instagram_url,
      tiktok: s.tiktok_url,
      facebook: s.facebook_url,
      phone: s.contact_phone,
      whatsapp: s.contact_phone && international ? `https://wa.me/${digits}` : null,
      viber: s.contact_phone && international ? `viber://chat?number=%2B${digits}` : null,
      email: s.contact_email,
      any: !!(s.instagram_url || s.tiktok_url || s.facebook_url || s.contact_phone || s.contact_email),
    };
  });
}

@Component({
  selector: 'app-delivery-page',
  imports: [RouterLink],
  templateUrl: './delivery-page.html',
  styleUrl: './info.scss',
})
export class DeliveryPage {
  private readonly shop = inject(ShopState);
  readonly pages = input.required<Loaded<ShopPages>>();

  protected readonly returns = computed(() => {
    const p = this.pages();
    return p.ok ? paragraphs(p.value.returns_text) : null;
  });

  /** Each country delivered to, with its fee as a customer there sees it. */
  protected readonly zones = computed(() => {
    const fx = this.shop.fx();
    const order = ['XK', 'MK', 'AL'];
    return [...(this.shop.context()?.zones ?? [])]
      .sort((a, b) => order.indexOf(a.country) - order.indexOf(b.country))
      .map((z) => ({
        country: COUNTRY_NAME[z.country],
        fee: z.fee_eur === 0 ? 'Free' : formatMoney(localPrice(z.fee_eur, z.currency, fx), z.currency),
        freeOver: z.fee_eur > 0 && z.free_over_eur !== null ? formatMoney(localPrice(z.free_over_eur, z.currency, fx), z.currency) : null,
        days: z.est_days,
        currency: z.currency,
      }));
  });

  /** "in euros in Kosovo, in denars in North Macedonia and in lek in Albania" */
  protected readonly currencies = computed(() => {
    const parts = this.zones().map((z) => `in ${CURRENCY_WORD[z.currency]} in ${z.country}`);
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '');
  });
}

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `
    <article class="info message">
      <h1>This page isn’t here</h1>
      <p class="muted">The link may be old or mistyped. Everything that’s for sale is in the shop.</p>
      <a class="btn btn-primary" routerLink="/">See what’s in the shop</a>
    </article>
  `,
  styleUrl: './info.scss',
})
export class NotFoundPage {
  constructor() {
    // So search engines drop dead links rather than list them.
    const response = inject(RESPONSE_INIT, { optional: true });
    if (response) response.status = 404;
  }
}
