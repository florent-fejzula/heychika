import { Component, inject, signal } from '@angular/core';
import { AppUpdate } from '../core/app-update';
import { TranslatePipe } from '../core/i18n';

/** "A new version is available", with a Refresh button. Shows over any page once a release is out. */
@Component({
  selector: 'app-update-banner',
  imports: [TranslatePipe],
  template: `
    @if (update.available() && !dismissed()) {
      <div class="banner no-print" role="status">
        <span>{{ 'common.update.available' | t }}</span>
        <button class="btn btn-primary btn-small" type="button" (click)="update.reload()">{{ 'common.update.refresh' | t }}</button>
        <button class="close" type="button" [attr.aria-label]="'common.update.later' | t" (click)="dismissed.set(true)">✕</button>
      </div>
    }
  `,
  styles: `
    .banner {
      position: fixed;
      left: 50%;
      bottom: calc(76px + env(safe-area-inset-bottom));
      z-index: 50;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 10px;
      width: max-content;
      max-width: calc(100vw - 2 * var(--gutter));
      padding: 8px 8px 8px 16px;
      border-radius: var(--radius);
      background: var(--ink);
      color: #fff;
      font-size: 0.875rem;
      box-shadow: 0 8px 24px rgba(31, 26, 28, 0.25);
    }

    .btn-primary {
      flex: none;
      background: #fff;
      border-color: #fff;
      color: var(--ink);
    }

    .close {
      flex: none;
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 50%;
      background: none;
      color: rgba(255, 255, 255, 0.75);
      cursor: pointer;
    }
  `,
})
export class UpdateBanner {
  protected readonly update = inject(AppUpdate);
  protected readonly dismissed = signal(false);
}
