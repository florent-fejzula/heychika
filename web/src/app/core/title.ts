import { Injectable, effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { I18n } from './i18n';

/**
 * Route titles are translation keys ("titles.orders"), shown in the language on
 * screen and changed with it. Pages without one (a product) set their own.
 */
@Injectable({ providedIn: 'root' })
export class I18nTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly i18n = inject(I18n);
  private key: string | undefined;

  constructor() {
    super();
    effect(() => {
      const lang = this.i18n.lang();
      if (this.key && lang) this.title.setTitle(this.i18n.t(this.key));
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.key = this.buildTitle(snapshot);
    if (this.key) this.title.setTitle(this.i18n.t(this.key));
  }
}
