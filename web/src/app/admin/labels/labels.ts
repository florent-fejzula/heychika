import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, Injector, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { barcodeImage } from '../../core/barcode';
import { Catalogue, LabelVariant } from '../../core/catalogue';
import { LAYOUTS, LabelLayout, labelsPerPage, paginate } from '../../core/labels';
import { TranslatePipe } from '../../core/i18n';
import { formatMoney } from '../../core/money';
import { Purchases } from '../../core/purchases';

interface Block {
  id: number;
  name: string;
  variants: LabelVariant[];
}

@Component({
  selector: 'app-labels',
  imports: [TranslatePipe],
  templateUrl: './labels.html',
  styleUrl: './labels.scss',
})
export class Labels {
  private readonly catalogue = inject(Catalogue);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  /** From `?product=ID`: opened from a design's “Print labels” button. */
  readonly product = input<string>();

  /** From `?purchase=ID`: one sticker per item that arrived on that buying trip. */
  readonly purchase = input<string>();

  protected readonly layouts = LAYOUTS;
  protected readonly variants = signal<LabelVariant[] | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly copies = signal<Readonly<Partial<Record<number, number>>>>({});
  protected readonly layoutId = signal(LAYOUTS[0].id);
  protected readonly skip = signal(0);
  protected readonly showPrice = signal(false);
  protected readonly search = signal('');
  private readonly barcodes = signal<ReadonlyMap<string, string>>(new Map());

  protected readonly layout = computed<LabelLayout>(() => LAYOUTS.find((l) => l.id === this.layoutId()) ?? LAYOUTS[0]);

  protected readonly blocks = computed<Block[]>(() => {
    const q = this.search().trim().toLowerCase();
    const copies = this.copies();
    const byProduct = new Map<number, Block>();
    for (const v of this.variants() ?? []) {
      // Archived designs stay out of the way, unless labels are already chosen for them.
      if (v.product.status === 'archived' && !copies[v.id]) continue;
      if (q && !`${v.product.name} ${v.sku}`.toLowerCase().includes(q) && !copies[v.id]) continue;
      const block = byProduct.get(v.product.id) ?? { id: v.product.id, name: v.product.name, variants: [] };
      block.variants.push(v);
      byProduct.set(v.product.id, block);
    }
    return [...byProduct.values()]
      .map((b) => ({
        ...b,
        variants: b.variants.sort((x, y) => x.color.name.localeCompare(y.color.name) || x.size.sort_order - y.size.sort_order),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /** One entry per sticker to print. */
  private readonly stickers = computed(() => {
    const copies = this.copies();
    return (this.variants() ?? []).flatMap((v) => Array<LabelVariant>(copies[v.id] ?? 0).fill(v));
  });

  protected readonly pages = computed(() => paginate(this.stickers(), this.layout(), this.skip()));
  protected readonly total = computed(() => this.stickers().length);
  protected readonly perPage = computed(() => labelsPerPage(this.layout()));

  constructor() {
    this.start().catch((e: Error) => this.error.set(e.message));

    // Render the barcode pictures for whatever is about to print.
    effect(() => {
      const codes = [...new Set(this.stickers().map((v) => v.barcode))];
      untracked(() => this.loadBarcodes(codes));
    });

    // The paper size has to be in a global @page rule, so it lives in the document head while this page is open.
    const style = this.document.createElement('style');
    this.document.head.appendChild(style);
    effect(() => {
      const l = this.layout();
      style.textContent = `@page { size: ${l.pageWidth}mm ${l.pageHeight}mm; margin: 0; }`;
    });
    inject(DestroyRef).onDestroy(() => style.remove());
  }

  private async start(): Promise<void> {
    const rows = await this.catalogue.labelVariants();
    this.variants.set(rows);

    const product = Number(this.product());
    if (product) this.fill(rows.filter((v) => v.product.id === product && v.active), () => 1);

    const purchase = Number(this.purchase());
    if (purchase) {
      // Looked up on demand, so opening Labels any other way doesn't need the purchases service.
      const arrived = new Map((await this.injector.get(Purchases).quantities(purchase)).map((l) => [l.variant_id, l.qty]));
      this.fill(rows.filter((v) => arrived.has(v.id)), (v) => arrived.get(v.id) ?? 0);
    }
  }

  protected setCopies(id: number, value: string): void {
    const n = Math.max(0, Math.min(99, Math.floor(Number(value)) || 0));
    this.copies.update((c) => ({ ...c, [id]: n }));
  }

  protected step(id: number, by: number): void {
    this.setCopies(id, String((this.copies()[id] ?? 0) + by));
  }

  protected oneEach(block: Block): void {
    this.fill(block.variants.filter((v) => v.active), () => 1);
  }

  protected matchStock(block: Block): void {
    this.fill(block.variants, (v) => v.stock?.qty_physical ?? 0);
  }

  protected clear(block?: Block): void {
    if (!block) {
      this.copies.set({});
      return;
    }
    this.fill(block.variants, () => 0);
  }

  protected setSkip(value: string): void {
    this.skip.set(Math.max(0, Math.floor(Number(value)) || 0));
  }

  protected barcode(v: LabelVariant): string | undefined {
    return this.barcodes().get(v.barcode) || undefined;
  }

  protected price(v: LabelVariant): string {
    return formatMoney(Number(v.price_eur), 'EUR');
  }

  protected print(): void {
    this.document.defaultView?.print();
  }

  private fill(rows: LabelVariant[], count: (v: LabelVariant) => number): void {
    this.copies.update((c) => ({ ...c, ...Object.fromEntries(rows.map((v) => [v.id, Math.min(99, count(v))])) }));
  }

  private async loadBarcodes(codes: string[]): Promise<void> {
    const missing = codes.filter((c) => !this.barcodes().has(c));
    if (!missing.length) return;
    const made = await Promise.all(missing.map(async (c) => [c, await barcodeImage(c).catch(() => '')] as const));
    this.barcodes.update((m) => new Map([...m, ...made]));
  }
}
