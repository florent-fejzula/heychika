import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Catalogue, Category, Colour, ProductSummary, Size, VariantRow } from '../../core/catalogue';
import { landedCosts } from '../../core/costing';
import { formatCode, formatMoney, parseAmount, parseCount } from '../../core/money';
import { PurchaseLine, PurchaseRow, Purchases, TripItem } from '../../core/purchases';

interface Photo {
  file: File;
  url: string;
}

const key = (colourId: number, sizeId: number) => `${colourId}-${sizeId}`;

/**
 * Adding stock in one go: what it is, its colours and sizes, how many of each, what
 * was paid and what it sells for. On a buying trip it's added to the trip (and goes
 * on the shelf when the trip is received); from Products or Stock it goes straight
 * on the shelf.
 *
 * The same form restocks a design that already exists: pick it, and its colours and
 * sizes are ticked for you.
 */
@Component({
  selector: 'app-add-item',
  imports: [RouterLink],
  templateUrl: './add-item.html',
  styleUrl: './add-item.scss',
})
export class AddItem {
  private readonly catalogue = inject(Catalogue);
  private readonly purchases = inject(Purchases);
  private readonly router = inject(Router);

  /** The trip, from `stock/purchases/:id/add`. Absent when adding straight to stock. */
  readonly id = input<string>();
  /** `?design=12`: more of a design that already exists. */
  readonly design = input<string>();

  protected readonly state = signal<'loading' | 'ready' | 'error' | 'missing' | 'received'>('loading');
  protected readonly loadError = signal('');

  protected readonly categories = signal<Category[]>([]);
  protected readonly colours = signal<Colour[]>([]);
  protected readonly sizes = signal<Size[]>([]);
  protected readonly designs = signal<ProductSummary[]>([]);
  protected readonly trip = signal<PurchaseRow | null>(null);
  protected readonly tripLines = signal<PurchaseLine[]>([]);
  protected readonly markup = signal(50);

  protected readonly mode = signal<'new' | 'existing'>('new');
  protected readonly search = signal('');
  protected readonly existing = signal<ProductSummary | null>(null);
  protected readonly existingVariants = signal<VariantRow[]>([]);

  protected readonly name = signal('');
  protected readonly categoryId = signal<number | null>(null);
  protected readonly colourIds = signal<number[]>([]);
  protected readonly sizeIds = signal<number[]>([]);
  protected readonly qty = signal<Record<string, string>>({});
  protected readonly fill = signal('');
  protected readonly paid = signal('');
  protected readonly price = signal('');
  /** Once the price is typed, the suggestion stops overwriting it. */
  protected readonly priceTouched = signal(false);
  protected readonly showOnline = signal(true);
  protected readonly photos = signal<Photo[]>([]);

  protected readonly saving = signal(false);
  protected readonly progress = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly onTrip = computed(() => this.id() !== undefined);
  protected readonly currency = computed(() => this.trip()?.currency ?? 'EUR');

  protected readonly category = computed(() => this.categories().find((c) => c.id === this.categoryId()) ?? null);

  /** Colours to pick from: the active ones, plus any the design already has. */
  protected readonly colourOptions = computed(() => {
    const own = new Set(this.existingVariants().map((v) => v.color_id));
    return this.colours().filter((c) => c.active || own.has(c.id));
  });

  /** Sizes of the kind the category uses (letters, numbers, one size), plus any the design already has. */
  protected readonly sizeOptions = computed(() => {
    const type = this.category()?.size_type;
    const own = new Set(this.existingVariants().map((v) => v.size_id));
    return this.sizes().filter((s) => own.has(s.id) || (type !== undefined && s.active && s.size_type === type));
  });

  protected readonly gridColours = computed(() => this.colourOptions().filter((c) => this.colourIds().includes(c.id)));
  protected readonly gridSizes = computed(() => this.sizeOptions().filter((s) => this.sizeIds().includes(s.id)));

  protected readonly total = computed(() => {
    let n = 0;
    for (const c of this.gridColours()) for (const s of this.gridSizes()) n += parseCount(this.qty()[key(c.id, s.id)] ?? '') ?? 0;
    return n;
  });

  protected readonly matches = computed(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return [];
    return this.designs()
      .filter((d) => d.status !== 'archived' && `${d.name} ${d.category.code}-${d.model_code}`.toLowerCase().includes(q))
      .slice(0, 8);
  });

  /**
   * What one item will really cost (with its share of the trip costs, shared the way
   * the trip says), and a selling price from the markup in Settings.
   */
  protected readonly estimate = computed(() => {
    const paid = parseAmount(this.paid());
    const qty = this.total();
    if (paid === null || qty === 0) return null;
    const trip = this.trip();
    const mine = new Set(this.existingVariants().map((v) => v.id));
    const others = this.tripLines()
      .filter((l) => !mine.has(l.variant_id))
      .map((l) => ({ qty: l.qty, unitPrice: Number(l.unit_price) }));
    const result = landedCosts([...others, { qty, unitPrice: paid }], {
      currencyPerEur: Number(trip?.currency_per_eur ?? 1),
      extraCostsEur: Number(trip?.extra_costs_eur ?? 0),
      method: trip?.allocation_method ?? 'by_quantity',
    });
    const landed = result.lines.at(-1)?.landedEur ?? 0;
    return { landed, suggested: Math.ceil(landed * (1 + this.markup() / 100)) };
  });

  constructor() {
    effect(() => {
      const id = this.id();
      const design = this.design();
      untracked(() => this.load(id, design));
    });

    // The suggested price fills the box until she types her own.
    effect(() => {
      const e = this.estimate();
      if (e && !untracked(() => this.priceTouched())) this.price.set(String(e.suggested));
    });

    inject(DestroyRef).onDestroy(() => this.photos().forEach((p) => URL.revokeObjectURL(p.url)));
  }

  // ------------------------------------------------------------------ choosing

  protected setMode(mode: 'new' | 'existing'): void {
    if (mode === this.mode()) return;
    this.mode.set(mode);
    this.reset();
  }

  protected async chooseDesign(d: ProductSummary): Promise<void> {
    this.error.set(null);
    try {
      const variants = await this.catalogue.listVariants(d.id);
      this.existing.set(d);
      this.existingVariants.set(variants);
      this.search.set('');
      this.name.set(d.name);
      this.categoryId.set(this.categories().find((c) => c.code === d.category.code)?.id ?? null);
      const active = variants.filter((v) => v.active);
      this.colourIds.set([...new Set(active.map((v) => v.color_id))]);
      this.sizeIds.set([...new Set(active.map((v) => v.size_id))]);

      // On a trip it may already be there: show what was entered, to correct it.
      const onTrip = new Map(this.tripLines().map((l) => [l.variant_id, l]));
      const qty: Record<string, string> = {};
      let paid = '';
      for (const v of variants) {
        const line = onTrip.get(v.id);
        if (line) {
          qty[key(v.color_id, v.size_id)] = String(line.qty);
          paid ||= String(line.unit_price);
        }
      }
      this.qty.set(qty);
      this.paid.set(paid);
      const price = active[0]?.price_eur ?? variants[0]?.price_eur;
      this.price.set(price !== undefined ? String(Number(price)) : '');
      this.priceTouched.set(price !== undefined);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  protected clearDesign(): void {
    this.reset();
  }

  protected chooseCategory(id: number): void {
    this.categoryId.set(id);
    const type = this.category()?.size_type;
    const fits = this.sizes().filter((s) => s.active && s.size_type === type);
    this.sizeIds.update((picked) => picked.filter((sid) => fits.some((s) => s.id === sid)));
    // One-size things have nothing to choose.
    if (type === 'one_size' && fits.length === 1) this.sizeIds.set([fits[0].id]);
  }

  protected toggleColour(id: number): void {
    this.colourIds.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  protected toggleSize(id: number): void {
    this.sizeIds.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  protected qtyOf(colourId: number, sizeId: number): string {
    return this.qty()[key(colourId, sizeId)] ?? '';
  }

  protected setQty(colourId: number, sizeId: number, value: string): void {
    this.qty.update((q) => ({ ...q, [key(colourId, sizeId)]: value }));
  }

  protected applyFill(): void {
    const n = parseCount(this.fill());
    if (n === null) {
      this.error.set('Enter a whole number to put in every box.');
      return;
    }
    const q: Record<string, string> = { ...this.qty() };
    for (const c of this.gridColours()) for (const s of this.gridSizes()) q[key(c.id, s.id)] = String(n);
    this.qty.set(q);
    this.error.set(null);
  }

  protected setPrice(value: string): void {
    this.price.set(value);
    this.priceTouched.set(true);
  }

  protected useSuggested(): void {
    const e = this.estimate();
    if (e) this.setPrice(String(e.suggested));
  }

  protected addPhotos(input: HTMLInputElement): void {
    const files = [...(input.files ?? [])];
    this.photos.update((list) => [...list, ...files.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
    input.value = '';
  }

  protected removePhoto(photo: Photo): void {
    URL.revokeObjectURL(photo.url);
    this.photos.update((list) => list.filter((p) => p !== photo));
  }

  // -------------------------------------------------------------------- saving

  protected async save(): Promise<void> {
    if (this.saving()) return;
    const existing = this.existing();
    const isNew = this.mode() === 'new';

    if (!isNew && !existing) return this.fail('Find the design first.');
    if (isNew && !this.name().trim()) return this.fail('Give it a name, like “Black satin wrap dress”.');
    if (isNew && !this.categoryId()) return this.fail('Choose a category.');
    if (!this.gridColours().length) return this.fail('Tick at least one colour.');
    if (!this.gridSizes().length) return this.fail('Tick at least one size.');

    const lines: TripItem['lines'] = [];
    for (const c of this.gridColours()) {
      for (const s of this.gridSizes()) {
        const text = this.qtyOf(c.id, s.id).trim();
        const n = text === '' ? 0 : parseCount(text);
        if (n === null) return this.fail(`“${text}” isn’t a number of items (${c.name} ${s.label}).`);
        lines.push({ color_id: c.id, size_id: s.id, qty: n });
      }
    }
    if (!lines.some((l) => l.qty > 0)) return this.fail('Enter how many you have in at least one box.');

    const paid = parseAmount(this.paid());
    if (paid === null) return this.fail(`Enter what you paid per item, in ${this.currency()}.`);
    const price = parseAmount(this.price());
    if (price === null) return this.fail('Enter the selling price in euros.');

    const item: TripItem = isNew
      ? { product_id: null, category_id: this.categoryId()!, name: this.name().trim(), show_online: this.showOnline(), price_eur: price, unit_price: paid, lines }
      : { product_id: existing!.id, price_eur: price, unit_price: paid, lines };

    this.saving.set(true);
    this.error.set(null);
    try {
      const trip = this.trip();
      const saved = await this.purchases.saveItem(trip?.id ?? null, item);

      const photos = this.photos();
      const startAt = existing?.images.length ?? 0;
      const failed: string[] = [];
      for (const [i, photo] of photos.entries()) {
        this.progress.set(`Uploading photo ${i + 1} of ${photos.length}…`);
        try {
          await this.catalogue.uploadImage(saved.product_id, photo.file, startAt + i);
        } catch {
          failed.push(photo.file.name);
        }
      }

      const added = this.total();
      if (trip) {
        await this.router.navigate(['/admin/stock/purchases', trip.id], {
          queryParams: { added: `${item.name ?? existing!.name}: ${added} ${added === 1 ? 'item' : 'items'}`, photos: failed.length || null },
        });
      } else {
        await this.router.navigate(['/admin/products', saved.product_id], {
          queryParams: { added, photos: failed.length || null },
        });
      }
    } catch (e) {
      this.fail((e as Error).message);
    } finally {
      this.saving.set(false);
      this.progress.set(null);
    }
  }

  protected money(amount: number): string {
    return formatMoney(amount, 'EUR');
  }

  protected inCurrency(amount: number): string {
    return formatCode(amount, this.currency());
  }

  private reset(): void {
    this.existing.set(null);
    this.existingVariants.set([]);
    this.search.set('');
    this.name.set('');
    this.categoryId.set(null);
    this.colourIds.set([]);
    this.sizeIds.set([]);
    this.qty.set({});
    this.paid.set('');
    this.price.set('');
    this.priceTouched.set(false);
    this.error.set(null);
  }

  private fail(text: string): void {
    this.error.set(text);
  }

  private async load(id: string | undefined, design: string | undefined): Promise<void> {
    this.state.set('loading');
    try {
      const [lookups, designs, markup] = await Promise.all([
        this.catalogue.lookups(),
        this.catalogue.listProducts(),
        this.purchases.markup(),
      ]);
      this.categories.set(lookups.categories.filter((c) => c.active));
      this.colours.set(lookups.colours);
      this.sizes.set(lookups.sizes);
      this.designs.set(designs);
      this.markup.set(markup);

      if (id !== undefined) {
        const trip = /^\d+$/.test(id) ? await this.purchases.get(Number(id)) : null;
        if (!trip) {
          this.state.set('missing');
          return;
        }
        this.trip.set(trip);
        if (trip.status === 'received') {
          this.state.set('received');
          return;
        }
        this.tripLines.set(await this.purchases.lines(trip.id));
      }

      const wanted = design && designs.find((d) => d.id === Number(design));
      if (wanted) {
        this.mode.set('existing');
        await this.chooseDesign(wanted);
      }
      this.state.set('ready');
    } catch (e) {
      this.loadError.set((e as Error).message);
      this.state.set('error');
    }
  }
}
