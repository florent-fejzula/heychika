import { Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '../../core/i18n';

const SHOWN = 6;

/**
 * Brands used before, under the Brand box: one tap fills it in. With nothing typed
 * it offers the most used; as she types, the ones that match.
 */
@Component({
  selector: 'app-brand-picks',
  imports: [TranslatePipe],
  template: `
    @if (offered().length) {
      <div class="picks" role="group" [attr.aria-label]="'admin.design.brandsUsed' | t">
        @for (b of offered(); track b) {
          <button class="chip" type="button" (click)="pick.emit(b)">{{ b }}</button>
        }
      </div>
    }
  `,
  styles: `
    .picks {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .chip {
      min-height: 32px;
      padding: 0 12px;
      font-size: 0.8125rem;
      color: inherit;
    }
  `,
})
export class BrandPicks {
  /** Most used first (Catalogue.brands). */
  readonly brands = input.required<string[]>();
  /** What's in the box now. */
  readonly value = input('');
  readonly pick = output<string>();

  protected readonly offered = computed(() => {
    const typed = this.value().trim().toLocaleLowerCase();
    if (!typed) return this.brands().slice(0, SHOWN);
    return this.brands()
      .filter((b) => b.toLocaleLowerCase() !== typed && b.toLocaleLowerCase().includes(typed))
      .slice(0, SHOWN);
  });
}
