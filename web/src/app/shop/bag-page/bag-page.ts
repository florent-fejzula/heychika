import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { COUNTRY_NAME } from '../../core/money';
import { Bag } from '../bag';
import { BagContents } from '../bag-contents';
import { ShopState } from '../shop-state';

@Component({
  selector: 'app-bag-page',
  imports: [RouterLink],
  templateUrl: './bag-page.html',
  styleUrl: './bag-page.scss',
})
export class BagPage {
  protected readonly bag = inject(Bag);
  protected readonly contents = inject(BagContents);
  protected readonly shop = inject(ShopState);

  protected readonly countryName = computed(() => COUNTRY_NAME[this.shop.country()]);

  constructor() {
    this.contents.load();
  }

  protected change(variantId: number, qty: number): void {
    this.bag.set(variantId, qty);
  }
}
