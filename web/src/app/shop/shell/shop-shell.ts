import { Component, afterNextRender, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { COUNTRY_CURRENCY, COUNTRY_NAME, Country } from '../../core/money';
import { Bag } from '../bag';
import { ShopState } from '../shop-state';

@Component({
  selector: 'app-shop-shell',
  imports: [RouterLink, RouterOutlet],
  templateUrl: './shop-shell.html',
  styleUrl: './shop-shell.scss',
})
export class ShopShell {
  protected readonly shop = inject(ShopState);
  protected readonly bag = inject(Bag);

  // Short names: the header has room for about eighteen characters on a phone.
  protected readonly countries = (['XK', 'MK', 'AL'] as Country[]).map((code) => ({
    code,
    name: code === 'MK' ? 'N. Macedonia' : COUNTRY_NAME[code],
    currency: COUNTRY_CURRENCY[code],
  }));

  constructor() {
    afterNextRender(() => this.bag.restore());
  }

  protected chooseCountry(value: string): void {
    this.shop.setCountry(value as Country);
  }
}
