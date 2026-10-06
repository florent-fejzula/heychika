import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Purchases } from '../../core/purchases';
import { Scanner } from './scanner';

export interface LinkableSize {
  variantId: number;
  design: string;
  colour: string;
  size: string;
  sku: string;
  barcode: string;
}

/** A size still on its SKU hasn't had its tag scanned yet. */
export const isLinked = (s: { sku: string; barcode: string }): boolean => s.barcode !== s.sku;

/**
 * The clothes arrive with barcodes on their tags. Scan a tag, say which size it is,
 * and from then on scanning that tag finds that size: when packing, looking up,
 * or adding to an order. One scan per size, not per item.
 */
@Component({
  selector: 'app-barcode-linker',
  imports: [Scanner],
  template: `
    <p class="progress"><strong>{{ linkedCount() }} of {{ sizes().length }}</strong> sizes linked to the barcode on their tag</p>

    <app-scanner label="Scan the tag of one item" placeholder="or type the barcode" (scanned)="onScan($event)" />

    @if (pending(); as code) {
      <div class="pick" role="group" aria-label="Which size is it?">
        <p>Which one is <code>{{ code }}</code>?</p>
        <div class="options">
          @for (s of unlinked(); track s.variantId) {
            <button class="btn" type="button" [disabled]="busy()" (click)="link(s, code)">
              {{ s.design }} · {{ s.colour }} <strong>{{ s.size }}</strong>
            </button>
          }
        </div>
        <button class="btn btn-small" type="button" (click)="pending.set(null)">None of these</button>
      </div>
    }

    @if (feedback(); as f) {
      <p class="notice" [class.notice-ok]="f.ok" [class.notice-error]="!f.ok" role="status">{{ f.text }}</p>
    }

    <ul class="sizes">
      @for (s of sizes(); track s.variantId) {
        <li>
          <span>{{ s.design }} · {{ s.colour }} <strong>{{ s.size }}</strong></span>
          @if (linked(s)) {
            <span class="code"><code>{{ s.barcode }}</code>
              <button class="btn btn-small" type="button" [disabled]="busy()" (click)="unlink(s)">Unlink</button></span>
          } @else {
            <span class="muted">not linked</span>
          }
        </li>
      }
    </ul>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    p {
      margin: 0;
    }

    .progress {
      font-size: 0.9375rem;
    }

    .pick {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      padding: 12px;
      border-radius: var(--radius-sm);
      background: var(--accent-soft);
    }

    .options {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .sizes {
      list-style: none;
      margin: 0;
      padding: 0;
      font-size: 0.875rem;

      li {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 8px 0;
        border-top: 1px solid var(--line);
      }
    }

    .code {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;

      code {
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }
  `,
})
export class BarcodeLinker {
  private readonly purchases = inject(Purchases);

  readonly sizes = input.required<LinkableSize[]>();
  /** After every change, so the page can reload the sizes. */
  readonly changed = output<void>();

  protected readonly pending = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly feedback = signal<{ ok: boolean; text: string } | null>(null);

  protected readonly linked = isLinked;
  protected readonly linkedCount = computed(() => this.sizes().filter(isLinked).length);
  protected readonly unlinked = computed(() => this.sizes().filter((s) => !isLinked(s)));

  protected onScan(raw: string): void {
    const code = raw.trim();
    if (!code) return;
    const known = this.sizes().find((s) => s.barcode === code || s.sku === code);
    if (known) {
      this.pending.set(null);
      this.feedback.set({ ok: true, text: `That’s ${describe(known)}, already linked.` });
      return;
    }
    if (!this.unlinked().length) {
      this.feedback.set({ ok: false, text: 'Every size here is linked already. That tag belongs to something else.' });
      return;
    }
    this.feedback.set(null);
    this.pending.set(code);
  }

  protected async link(size: LinkableSize, code: string): Promise<void> {
    await this.change(size, code, `Linked: scanning that tag now finds ${describe(size)}.`);
  }

  protected async unlink(size: LinkableSize): Promise<void> {
    await this.change(size, null, `${describe(size)} is unlinked.`);
  }

  private async change(size: LinkableSize, code: string | null, done: string): Promise<void> {
    this.busy.set(true);
    try {
      await this.purchases.linkBarcode(size.variantId, code);
      this.pending.set(null);
      this.feedback.set({ ok: true, text: done });
      this.changed.emit();
    } catch (e) {
      this.feedback.set({ ok: false, text: (e as Error).message });
    } finally {
      this.busy.set(false);
    }
  }
}

function describe(s: LinkableSize): string {
  return `${s.design}, ${s.colour} ${s.size}`;
}
