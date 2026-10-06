import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { I18n, LANGS, Lang, TranslatePipe } from '../core/i18n';

/** The flag in the top corner: opens a short menu of the languages, each with its flag. */
@Component({
  selector: 'app-lang-picker',
  imports: [TranslatePipe],
  template: `
    <button
      class="current"
      type="button"
      aria-haspopup="menu"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="'common.language' | t: { name: currentLang().name }"
      (click)="open.set(!open())"
    >
      <img [src]="currentLang().flag" alt="" width="24" height="18" />
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
    </button>
    @if (open()) {
      <div class="menu" role="menu">
        @for (l of langs; track l.code) {
          <button
            type="button"
            role="menuitemradio"
            [attr.aria-checked]="l.code === i18n.lang()"
            [attr.lang]="l.code"
            (click)="choose(l.code)"
          >
            <img [src]="l.flag" alt="" width="24" height="18" />
            <span>{{ l.name }}</span>
            @if (l.code === i18n.lang()) {
              <svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
            }
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host {
      position: relative;
      flex: none;
    }

    img {
      display: block;
      width: 24px;
      height: 18px;
      border-radius: 3px;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12);
      object-fit: cover;
    }

    svg {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .current {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: var(--tap);
      padding: 0 6px;
      border: 0;
      background: none;
      color: var(--ink-soft);
      cursor: pointer;
    }

    .menu {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      z-index: 20;
      min-width: 168px;
      padding: 6px;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: 0 8px 24px rgba(31, 26, 28, 0.12);

      button {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: var(--tap);
        padding: 0 10px;
        border: 0;
        border-radius: var(--radius-sm);
        background: none;
        color: var(--ink);
        font: 500 0.9375rem var(--font-ui);
        text-align: left;
        cursor: pointer;

        &:hover,
        &:focus-visible {
          background: var(--paper);
        }
      }

      .tick {
        margin-left: auto;
        width: 16px;
        height: 16px;
        color: var(--accent);
      }
    }
  `,
  host: {
    '(document:click)': 'closeIfOutside($event)',
    '(document:keydown.escape)': 'open.set(false)',
  },
})
export class LangPicker {
  protected readonly i18n = inject(I18n);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly langs = LANGS;
  protected readonly open = signal(false);
  protected readonly currentLang = computed(() => LANGS.find((l) => l.code === this.i18n.lang()) ?? LANGS[0]);

  protected async choose(lang: Lang): Promise<void> {
    this.open.set(false);
    await this.i18n.use(lang);
  }

  protected closeIfOutside(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
}
