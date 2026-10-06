import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, NamedPipe, TranslatePipe } from '../../core/i18n';
import { Bag } from '../bag';
import { BagContents } from '../bag-contents';
import { ShopState } from '../shop-state';

@Component({
  selector: 'app-bag-page',
  imports: [RouterLink, TranslatePipe, NamedPipe],
  templateUrl: './bag-page.html',
  styleUrl: './bag-page.scss',
})
export class BagPage {
  protected readonly bag = inject(Bag);
  protected readonly contents = inject(BagContents);
  protected readonly shop = inject(ShopState);
  private readonly i18n = inject(I18n);

  protected readonly countryName = computed(() => this.i18n.t('common.countryIn.' + this.shop.country()));

  constructor() {
    this.contents.load();
  }

  protected change(variantId: number, qty: number): void {
    this.bag.set(variantId, qty);
  }
}
