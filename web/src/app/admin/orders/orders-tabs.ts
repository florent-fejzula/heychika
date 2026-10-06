import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '../../core/i18n';

// Orders and the people who place them.
@Component({
  selector: 'app-orders-tabs',
  imports: [RouterLink, RouterLinkActive, TranslatePipe],
  template: `
    <nav class="tabs" [attr.aria-label]="'admin.orders.sections' | t">
      <a routerLink="/admin/orders" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" ariaCurrentWhenActive="page">{{ 'admin.shell.orders' | t }}</a>
      <a routerLink="/admin/customers" routerLinkActive="active" ariaCurrentWhenActive="page">{{ 'admin.customers.title' | t }}</a>
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
export class OrdersTabs {}
