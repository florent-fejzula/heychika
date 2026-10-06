import { Component, afterNextRender, effect, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { RouterLink, RouterOutlet } from '@angular/router';
import { I18n, TranslatePipe } from '../../core/i18n';
import { COUNTRY_CURRENCY, Country } from '../../core/money';
import { LangPicker } from '../../shared/lang-picker';
import { Bag } from '../bag';
import { ShopState } from '../shop-state';

@Component({
  selector: 'app-shop-shell',
  imports: [RouterLink, RouterOutlet, TranslatePipe, LangPicker],
  templateUrl: './shop-shell.html',
  styleUrl: './shop-shell.scss',
})
export class ShopShell {
  protected readonly shop = inject(ShopState);
  protected readonly bag = inject(Bag);

  // Short names: the header has room for about eighteen characters on a phone.
  protected readonly countries = (['XK', 'MK', 'AL'] as Country[]).map((code) => ({
    code,
    name: code === 'MK' ? 'common.country.MK_short' : `common.country.${code}`,
    currency: COUNTRY_CURRENCY[code],
  }));

  constructor() {
    afterNextRender(() => this.bag.restore());

    // What search results and shared links say about the shop, in the visitor's
    // language. A product page sets its own afterwards.
    const i18n = inject(I18n);
    const meta = inject(Meta);
    effect(() => meta.updateTag({ name: 'description', content: i18n.t('shop.meta.description') }));
  }

  protected chooseCountry(value: string): void {
    this.shop.setCountry(value as Country);
  }
}
