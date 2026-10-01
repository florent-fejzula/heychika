import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Catalogue, ProductSummary, VariantRow } from '../../core/catalogue';
import { parseAmount, parseCount } from '../../core/money';
import { PurchaseLine, Purchases } from '../../core/purchases';

// Choose a design, then fill in how many of each colour and size were bought.
// Saving replaces what the trip already holds for that design, so it works for
// adding and for correcting.
@Component({
  selector: 'app-purchase-lines',
  imports: [RouterLink],
  templateUrl: './purchase-lines.html',
  styleUrl: './purchase-lines.scss',
})
export class PurchaseLines {
  private readonly catalogue = inject(Catalogue);
  private readonly purchases = inject(Purchases);

  readonly purchaseId = input.required<number>();
  readonly currency = input.required<string>();
  readonly designs = input.required<ProductSummary[]>();
  /** What the trip already holds. */
  readonly lines = input.required<PurchaseLine[]>();
  readonly saved = output<void>();

  protected readonly query = signal('');
  protected readonly designId = signal<number | null>(null);
  protected readonly variants = signal<VariantRow[]>([]);
  protected readonly qty = signal<Readonly<Partial<Record<number, string>>>>({});
  protected readonly price = signal('');
  protected readonly fillAll = signal('');
  protected readonly busy = signal(false);
  protected readonly message = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);

  protected readonly options = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.designs()
      .filter((d) => d.status !== 'archived' && (!q || `${d.name} ${d.category.code}-${d.model_code}`.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  protected readonly design = computed(() => this.designs().find((d) => d.id === this.designId()) ?? null);

  protected readonly sizes = computed(() => {
    const seen = new Map<number, VariantRow['size']>();
    for (const v of this.variants()) seen.set(v.size_id, v.size);
    return [...seen].sort((a, b) => a[1].sort_order - b[1].sort_order);
  });

  protected readonly colours = computed(() => {
    const seen = new Map<number, VariantRow['color']>();
    for (const v of this.variants()) seen.set(v.color_id, v.color);
    return [...seen].sort((a, b) => a[1].name.localeCompare(b[1].name));
  });

  protected readonly total = computed(() =>
    this.variants().reduce((sum, v) => sum + (parseCount(this.qty()[v.id] ?? '') ?? 0), 0),
  );

  constructor() {
    // The trip's own lines change when something is saved elsewhere; keep the grid in step.
    effect(() => {
      this.lines();
      untracked(() => this.prefill());
    });
  }

  protected async choose(value: string): Promise<void> {
    const id = value ? Number(value) : null;
    this.designId.set(id);
    this.message.set(null);
    this.variants.set([]);
    if (id === null) return;

    try {
      this.variants.set(await this.catalogue.listVariants(id));
      this.prefill();
    } catch (e) {
      this.message.set({ kind: 'error', text: (e as Error).message });
    }
  }

  protected variantAt(colorId: number, sizeId: number): VariantRow | undefined {
    return this.variants().find((v) => v.color_id === colorId && v.size_id === sizeId);
  }

  protected setQty(variantId: number, value: string): void {
    this.qty.update((q) => ({ ...q, [variantId]: value }));
  }

  protected applyFill(): void {
    const n = parseCount(this.fillAll());
    if (n === null) {
      this.message.set({ kind: 'error', text: 'Enter a whole number to put in every box.' });
      return;
    }
    this.qty.set(Object.fromEntries(this.variants().map((v) => [v.id, String(n)])));
    this.message.set(null);
  }

  protected async save(): Promise<void> {
    if (this.busy()) return;
    const design = this.design();
    if (!design) return;

    const keep: { variant_id: number; qty: number; unit_price: number }[] = [];
    const drop: number[] = [];
    const held = new Set(this.lines().map((l) => l.variant_id));
    const price = parseAmount(this.price());

    for (const v of this.variants()) {
      const text = (this.qty()[v.id] ?? '').trim();
      const n = text === '' ? 0 : parseCount(text);
      if (n === null) return this.fail(`“${text}” isn’t a number of items (${v.color.name} ${v.size.label}).`);
      if (n > 0) {
        if (price === null) return this.fail(`Enter what you paid per item in ${this.currency()}, for example 12.50.`);
        keep.push({ variant_id: v.id, qty: n, unit_price: price });
      } else if (held.has(v.id)) {
        drop.push(v.id);
      }
    }
    if (!keep.length && !drop.length) return this.fail('Enter how many you bought in at least one box.');

    this.busy.set(true);
    this.message.set(null);
    try {
      await this.purchases.saveLines(this.purchaseId(), keep);
      await this.purchases.removeLines(this.purchaseId(), drop);
      const items = keep.reduce((n, r) => n + r.qty, 0);
      this.message.set({ kind: 'ok', text: `${design.name}: ${items} ${items === 1 ? 'item' : 'items'} on this trip.` });
      this.saved.emit();
    } catch (e) {
      this.message.set({ kind: 'error', text: (e as Error).message });
    } finally {
      this.busy.set(false);
    }
  }

  /** Fill the grid from what the trip already holds for the chosen design. */
  private prefill(): void {
    const variants = this.variants();
    if (!variants.length) return;
    const byVariant = new Map(this.lines().map((l) => [l.variant_id, l]));
    const q: Record<number, string> = {};
    let price = '';
    for (const v of variants) {
      const line = byVariant.get(v.id);
      if (line) {
        q[v.id] = String(line.qty);
        price ||= String(line.unit_price);
      }
    }
    this.qty.set(q);
    // Never carry a price over from another design: forgetting to change it would silently mis-cost the stock.
    this.price.set(price);
  }

  private fail(text: string): void {
    this.message.set({ kind: 'error', text });
  }
}
