import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Catalogue, Category, Colour, ProductSummary, Size, VariantRow, sameBrand } from '../../core/catalogue';
import { estimateLanded } from '../../core/costing';
import { I18n, TranslatePipe } from '../../core/i18n';
import { pastedImages } from '../../core/images';
import { formatCode, formatMoney, parseAmount, parseCount, parseRate } from '../../core/money';
import { PurchaseCurrency, PurchaseLine, PurchaseRow, PurchaseSummary, Purchases, TripItem } from '../../core/purchases';
import { BrandPicks } from '../shared/brand-picks';

interface Photo {
  file: File;
  url: string;
}

interface NewTrip {
  reference: string;
  date: string;
  costs: string;
  expected: string;
  currency: PurchaseCurrency;
  rate: string;
}

const key = (colourId: number, sizeId: number) => `${colourId}-${sizeId}`;
const blankToNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Adding stock in one go: what it is (with its description, material and brand),
 * its colours and sizes, how many of each, what was paid and what it sells for.
 *
 * Bought on a buying trip, it's added to the trip (and goes on the shelf when the
 * trip is received), and the trip's costs count in the suggested price. The trip is
 * picked here, or made here in a few boxes without leaving the form. With no trip
 * it goes straight on the shelf.
 *
 * The same form restocks a design that already exists: pick it, and its colours and
 * sizes are ticked for you.
 */
@Component({
  selector: 'app-add-item',
  imports: [RouterLink, TranslatePipe, BrandPicks],
  templateUrl: './add-item.html',
  styleUrl: './add-item.scss',
  host: { '(document:paste)': 'onPaste($event)' },
})
export class AddItem {
  private readonly catalogue = inject(Catalogue);
  private readonly purchases = inject(Purchases);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);

  /** The trip, from `stock/purchases/:id/add`. Absent on `stock/add`, where one can be picked. */
  readonly id = input<string>();
  /** `?design=12`: more of a design that already exists. */
  readonly design = input<string>();

  protected readonly state = signal<'loading' | 'ready' | 'error' | 'missing' | 'received'>('loading');
  protected readonly loadError = signal('');

  protected readonly categories = signal<Category[]>([]);
  protected readonly colours = signal<Colour[]>([]);
  protected readonly sizes = signal<Size[]>([]);
  protected readonly designs = signal<ProductSummary[]>([]);
  /** Trips not received yet: the ones items can still go on. */
  protected readonly trips = signal<PurchaseSummary[]>([]);
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
  protected readonly featured = signal(false);
  protected readonly description = signal('');
  protected readonly material = signal('');
  protected readonly brand = signal('');
  protected readonly brands = signal<string[]>([]);
  protected readonly photos = signal<Photo[]>([]);

  protected readonly saving = signal(false);
  protected readonly progress = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  /** A new trip, made without leaving the form. */
  protected readonly newTrip = signal<NewTrip | null>(null);
  protected readonly tripError = signal<string | null>(null);
  protected readonly creatingTrip = signal(false);
  protected readonly expected = signal('');
  protected readonly currencies: PurchaseCurrency[] = ['EUR', 'USD', 'TRY'];

  protected readonly onTrip = computed(() => this.trip() !== null);
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
   * the trip says), and a selling price from the markup in Settings. `tripAdds` is
   * how much more that price is because of the trip costs.
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
    const tripCosts = Number(trip?.extra_costs_eur ?? 0);
    const e = estimateLanded(others, { qty, unitPrice: paid }, {
      currencyPerEur: Number(trip?.currency_per_eur ?? 1),
      extraCostsEur: tripCosts,
      method: trip?.allocation_method ?? 'by_quantity',
    }, trip?.expected_items ?? null);
    const priced = (cost: number) => Math.ceil(cost * (1 + this.markup() / 100));
    const suggested = priced(e.landedEur);
    return {
      paid: e.unitPriceEur,
      share: e.extraEur,
      landed: e.landedEur,
      suggested,
      tripAdds: suggested - priced(e.unitPriceEur),
      tripCosts,
      spreadOver: e.spreadOver,
      /** The trip doesn't say how many items it brought, so the costs sit on the few entered so far. */
      guessing: tripCosts > 0 && !trip?.expected_items,
    };
  });

  constructor() {
    effect(() => {
      const id = this.id();
      const design = this.design();
      untracked(() => this.load(id, design));
    });

    // The suggested price fills the box until she types her own. Not while the trip
    // costs sit on only the few items entered so far: that price would be far too
    // high, so it waits for her to say how many the trip brought (or to choose).
    effect(() => {
      const e = this.estimate();
      if (e && !untracked(() => this.priceTouched())) this.price.set(e.guessing ? '' : String(e.suggested));
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
      this.error.set(this.i18n.t('admin.addItem.enterWhole'));
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
    this.addFiles([...(input.files ?? [])]);
    input.value = '';
  }

  /** Ctrl+V of a screenshot or a copied photo, anywhere on the page. */
  protected onPaste(event: ClipboardEvent): void {
    if (this.state() !== 'ready' || this.mode() !== 'new') return;
    const files = pastedImages(event);
    if (!files.length) return;
    event.preventDefault();
    this.addFiles(files);
  }

  private addFiles(files: File[]): void {
    this.photos.update((list) => [...list, ...files.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  }

  protected removePhoto(photo: Photo): void {
    URL.revokeObjectURL(photo.url);
    this.photos.update((list) => list.filter((p) => p !== photo));
  }

  // --------------------------------------------------------------------- trips

  /** '' for none (straight onto the shelf), else a trip id. */
  protected async chooseTrip(value: string): Promise<void> {
    this.tripError.set(null);
    this.newTrip.set(null);
    if (!value) {
      this.trip.set(null);
      this.tripLines.set([]);
      return;
    }
    const id = Number(value);
    try {
      const [trip, lines] = await Promise.all([this.purchases.get(id), this.purchases.lines(id)]);
      this.trip.set(trip);
      this.tripLines.set(lines);
    } catch (e) {
      this.tripError.set((e as Error).message);
    }
  }

  protected openNewTrip(): void {
    this.tripError.set(null);
    this.newTrip.set({ reference: '', date: today(), costs: '', expected: '', currency: 'EUR', rate: '' });
  }

  protected editNewTrip(change: Partial<NewTrip>): void {
    this.newTrip.update((t) => (t ? { ...t, ...change } : t));
  }

  /** Makes the trip, picks it, and carries on with the item. */
  protected async createTrip(): Promise<void> {
    const t = this.newTrip();
    if (!t || this.creatingTrip()) return;
    const rate = t.currency === 'EUR' ? 1 : parseRate(t.rate);
    const costs = t.costs.trim() === '' ? 0 : parseAmount(t.costs);
    const expected = t.expected.trim() === '' ? null : parseCount(t.expected);

    const fail = (key: string, params?: Record<string, unknown>) => this.tripError.set(this.i18n.t(key, params));
    if (!t.reference.trim()) return fail('admin.trip.nameIt');
    if (!t.date) return fail('admin.trip.pickDate');
    if (rate === null) return fail('admin.trip.enterRate', { currency: t.currency, example: t.currency === 'TRY' ? '38.5' : '1.08' });
    if (costs === null) return fail('admin.trip.enterCosts');
    if (expected === 0 || (t.expected.trim() !== '' && expected === null)) return fail('admin.trip.enterExpected');

    this.creatingTrip.set(true);
    this.tripError.set(null);
    try {
      const id = await this.purchases.create({
        reference: t.reference.trim(),
        supplier_name: null,
        purchase_date: t.date,
        currency: t.currency,
        currency_per_eur: rate,
        extra_costs_eur: costs,
        allocation_method: 'by_quantity',
        notes: null,
        ...(expected !== null && { expected_items: expected }),
      });
      this.trips.set((await this.purchases.list()).filter((p) => p.status === 'draft'));
      await this.chooseTrip(String(id));
    } catch (e) {
      this.tripError.set((e as Error).message);
    } finally {
      this.creatingTrip.set(false);
    }
  }

  /** For a trip that doesn't say yet how many items it brought. */
  protected async saveExpected(): Promise<void> {
    const trip = this.trip();
    const n = parseCount(this.expected());
    if (!trip) return;
    if (!n) {
      this.tripError.set(this.i18n.t('admin.trip.enterExpected'));
      return;
    }
    try {
      await this.purchases.setExpectedItems(trip.id, n);
      this.trip.set({ ...trip, expected_items: n });
      this.trips.update((list) => list.map((p) => (p.id === trip.id ? { ...p, expected_items: n } : p)));
      this.tripError.set(null);
      this.expected.set('');
    } catch (e) {
      this.tripError.set((e as Error).message);
    }
  }

  // -------------------------------------------------------------------- saving

  protected async save(): Promise<void> {
    if (this.saving()) return;
    const existing = this.existing();
    const isNew = this.mode() === 'new';

    if (!isNew && !existing) return this.fail('admin.addItem.findFirst');
    if (isNew && !this.name().trim()) return this.fail('admin.addItem.nameIt');
    if (isNew && !this.categoryId()) return this.fail('admin.addItem.chooseCategory');
    if (!this.gridColours().length) return this.fail('admin.addItem.tickColour');
    if (!this.gridSizes().length) return this.fail('admin.addItem.tickSize');

    const lines: TripItem['lines'] = [];
    for (const c of this.gridColours()) {
      for (const s of this.gridSizes()) {
        const text = this.qtyOf(c.id, s.id).trim();
        const n = text === '' ? 0 : parseCount(text);
        if (n === null) return this.fail('admin.addItem.notANumber', { text, colour: c.name, size: s.label });
        lines.push({ color_id: c.id, size_id: s.id, qty: n });
      }
    }
    if (!lines.some((l) => l.qty > 0)) return this.fail('admin.addItem.enterOne');

    const paid = parseAmount(this.paid());
    if (paid === null) return this.fail('admin.addItem.enterPaid', { currency: this.currency() });
    const price = parseAmount(this.price());
    if (price === null) return this.fail('admin.addItem.enterPrice');

    const item: TripItem = isNew
      ? {
          product_id: null,
          category_id: this.categoryId()!,
          name: this.name().trim(),
          description: blankToNull(this.description()),
          material: blankToNull(this.material()),
          brand: sameBrand(this.brand(), this.brands()),
          show_online: this.showOnline(),
          featured: this.featured(),
          price_eur: price,
          unit_price: paid,
          lines,
        }
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
        this.progress.set(this.i18n.t('admin.images.uploadingN', { n: i + 1, total: photos.length }));
        try {
          await this.catalogue.uploadImage(saved.product_id, photo.file, startAt + i);
        } catch {
          failed.push(photo.file.name);
        }
      }

      const added = this.total();
      if (trip) {
        await this.router.navigate(['/admin/stock/purchases', trip.id], {
          queryParams: { added, name: item.name ?? existing!.name, photos: failed.length || null },
        });
      } else {
        await this.router.navigate(['/admin/products', saved.product_id], {
          queryParams: { added, photos: failed.length || null },
        });
      }
    } catch (e) {
      this.error.set((e as Error).message);
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
    this.description.set('');
    this.material.set('');
    this.brand.set('');
    this.featured.set(false);
    this.error.set(null);
  }

  private fail(key: string, params?: Record<string, unknown>): void {
    this.error.set(this.i18n.t(key, params));
  }

  private async load(id: string | undefined, design: string | undefined): Promise<void> {
    this.state.set('loading');
    try {
      const [lookups, designs, markup, trips, brands] = await Promise.all([
        this.catalogue.lookups(),
        this.catalogue.listProducts(),
        this.purchases.markup(),
        this.purchases.list(),
        this.catalogue.brands(),
      ]);
      this.trips.set(trips.filter((p) => p.status === 'draft'));
      this.brands.set(brands);
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
