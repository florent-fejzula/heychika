import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '../../core/i18n';

// Stock and buying trips are two views of the same thing: what you have, and how it got here.
@Component({
  selector: 'app-stock-tabs',
  imports: [RouterLink, RouterLinkActive, TranslatePipe],
  template: `
    <nav class="tabs" [attr.aria-label]="'admin.stock.sections' | t">
      <a routerLink="/admin/stock" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" ariaCurrentWhenActive="page">{{ 'admin.dashboard.onShelf' | t }}</a>
      <a routerLink="/admin/stock/purchases" routerLinkActive="active" ariaCurrentWhenActive="page">{{ 'admin.trips.title' | t }}</a>
    </nav>
  `,
  styles: `
    .tabs {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid var(--line);
    }

    a {
      padding: 10px 14px;
      margin-bottom: -1px;
      border-bottom: 2px solid transparent;
      color: var(--ink-soft);
      text-decoration: none;
      font-weight: 500;
    }

    a.active {
      color: var(--ink);
      border-bottom-color: var(--accent);
    }
  `,
})
export class StockTabs {}
