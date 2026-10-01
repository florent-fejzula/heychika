import { Component, ElementRef, PLATFORM_ID, computed, effect, inject, input, linkedSignal, signal, viewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { COUNTRY_NAME } from '../../core/money';
import { Bag, MAX_PER_ITEM } from '../bag';
import { Loaded } from '../resolvers';
import { ShopApi, ShopProduct, ShopVariant, slugify } from '../shop-api';
import { ShopState } from '../shop-state';

/** Below this, the page says how many are left. */
const FEW_LEFT = 3;

@Component({
  selector: 'app-product-page',
  imports: [RouterLink],
  templateUrl: './product-page.html',
  styleUrl: './product-page.scss',
})
export class ProductPage {
  private readonly api = inject(ShopApi);
  private readonly bag = inject(Bag);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly shop = inject(ShopState);

  readonly product = input.required<Loaded<ShopProduct | null>>();
  /** ?colour=black, from a filtered list or a shared link. */
  readonly colour = input<string>();

  protected readonly failed = computed(() => !this.product().ok);
  protected readonly p = computed(() => {
    const r = this.product();
    return r.ok ? r.value : null;
  });

  protected readonly colours = computed(() => {
    const seen = new Map<number, ShopVariant['color'] & { inStock: boolean }>();
    for (const v of this.p()?.variants ?? []) {
      const c = seen.get(v.color.id);
      seen.set(v.color.id, { ...v.color, inStock: (c?.inStock ?? false) || v.available > 0 });
    }
    return [...seen.values()];
  });

  protected readonly sizes = computed(() => {
    const seen = new Map<number, ShopVariant['size']>();
    for (const v of this.p()?.variants ?? []) seen.set(v.size.id, v.size);
    return [...seen.values()].sort((a, b) => a.sort_order - b.sort_order);
  });

  // The colour asked for in the link, else the first one in stock.
  protected readonly colourId = linkedSignal(() => {
    const wanted = this.colour();
    const match = wanted && this.colours().find((c) => slugify(c.name) === wanted);
    return (match || this.colours().find((c) => c.inStock) || this.colours()[0])?.id ?? null;
  });

  // Nothing chosen until she picks, unless there's only one size to pick.
  protected readonly sizeId = linkedSignal<number | null>(() => {
    const sizes = this.sizes();
    return sizes.length === 1 ? sizes[0].id : null;
  });

  protected readonly categorySlug = computed(() => slugify(this.p()?.category.name ?? ''));

  protected readonly colourName = computed(() => this.colours().find((c) => c.id === this.colourId())?.name ?? '');

  protected readonly variant = computed(() =>
    this.p()?.variants.find((v) => v.color.id === this.colourId() && v.size.id === this.sizeId()) ?? null,
  );

  /** What one size looks like in the chosen colour: there, sold out, or not made. */
  protected sizeState(sizeId: number): 'ok' | 'sold_out' | 'none' {
    const v = this.p()?.variants.find((x) => x.color.id === this.colourId() && x.size.id === sizeId);
    return !v ? 'none' : v.available > 0 ? 'ok' : 'sold_out';
  }

  /** The price on show: the chosen size's, else the cheapest of the chosen colour. */
  protected readonly shown = computed(() => {
    const chosen = this.variant();
    if (chosen) return { eur: chosen.price_eur, was: chosen.compare_at_price_eur, from: false };
    const options = (this.p()?.variants ?? []).filter((v) => v.color.id === this.colourId());
    if (!options.length) return null;
    const cheapest = options.reduce((a, b) => (b.price_eur < a.price_eur ? b : a));
    return {
      eur: cheapest.price_eur,
      was: cheapest.compare_at_price_eur,
      from: new Set(options.map((v) => v.price_eur)).size > 1,
    };
  });

  protected readonly photos = computed(() => {
    const p = this.p();
    if (!p) return [];
    const mine = p.images.filter((i) => i.color_id === this.colourId() || i.color_id === null);
    return (mine.length ? mine : p.images).map((i) => ({
      full: this.api.imageUrl(i.storage_path),
      thumb: this.api.imageUrl(i.storage_path, true),
    }));
  });

  protected readonly photoIndex = signal(0);
  private readonly gallery = viewChild<ElementRef<HTMLElement>>('gallery');

  protected readonly fewLeft = computed(() => {
    const v = this.variant();
    return v && v.available > 0 && v.available < FEW_LEFT ? v.available : null;
  });

  /** How many more of the chosen size can go in the bag. */
  protected readonly canAdd = computed(() => {
    const v = this.variant();
    if (!v) return 0;
    return Math.max(0, Math.min(v.available, MAX_PER_ITEM) - this.bag.qtyOf(v.id));
  });

  protected readonly inBag = computed(() => {
    const v = this.variant();
    return v ? this.bag.qtyOf(v.id) : 0;
  });

  protected readonly justAdded = signal(false);
  protected readonly shared = signal<'copied' | null>(null);
  protected readonly MAX_PER_ITEM = MAX_PER_ITEM;

  protected readonly delivery = computed(() => {
    const zone = this.shop.zone();
    if (!zone) return null;
    return {
      country: COUNTRY_NAME[zone.country],
      fee: this.shop.price(zone.fee_eur),
      free: zone.fee_eur === 0,
      freeOver: zone.free_over_eur !== null ? this.shop.price(zone.free_over_eur) : null,
      days: zone.est_days,
    };
  });

  constructor() {
    // Title and link preview. When the page is shared in a DM, Instagram and
    // WhatsApp read these from the server-rendered page to draw the preview card.
    effect(() => {
      const p = this.p();
      const store = this.shop.storeName();
      if (!p) {
        this.title.setTitle(`${this.failed() ? 'Shop' : 'Not available'} · ${store}`);
        return;
      }
      const description = (p.description ?? '').trim().slice(0, 200) || `${p.name}, from ${store}. Cash on delivery.`;
      const image = p.images[0] ? this.api.imageUrl(p.images[0].storage_path) : null;
      this.title.setTitle(`${p.name} · ${store}`);
      this.meta.updateTag({ name: 'description', content: description });
      this.meta.updateTag({ property: 'og:title', content: p.name });
      this.meta.updateTag({ property: 'og:description', content: description });
      this.meta.updateTag({ property: 'og:type', content: 'product' });
      this.meta.updateTag({ property: 'og:site_name', content: store });
      if (image) this.meta.updateTag({ property: 'og:image', content: image });
      else this.meta.removeTag("property='og:image'");
    });

    // A new colour shows its own photos from the first one.
    effect(() => {
      this.colourId();
      this.photoIndex.set(0);
      if (this.browser) this.gallery()?.nativeElement.scrollTo?.({ left: 0 });
    });
  }

  protected chooseColour(id: number): void {
    this.colourId.set(id);
    this.justAdded.set(false);
    // Keep the size if this colour has it in stock; otherwise ask again.
    const size = this.sizeId();
    if (size !== null && this.sizeState(size) !== 'ok' && this.sizes().length > 1) this.sizeId.set(null);
  }

  protected chooseSize(id: number): void {
    this.sizeId.set(id);
    this.justAdded.set(false);
  }

  protected add(): void {
    const v = this.variant();
    if (!v || this.canAdd() === 0) return;
    this.bag.restore();
    this.bag.add(v.id, 1);
    this.justAdded.set(true);
  }

  protected onScroll(el: HTMLElement): void {
    this.photoIndex.set(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
  }

  protected showPhoto(index: number): void {
    const el = this.gallery()?.nativeElement;
    el?.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' });
  }

  // The link she pastes into a DM. On a phone this opens the share sheet
  // (Instagram, WhatsApp, ...); elsewhere it copies the link.
  protected async share(): Promise<void> {
    const p = this.p();
    if (!p || !this.browser) return;
    const url = `${location.origin}/p/${p.slug}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: p.name, url });
      } catch {
        // Closed the share sheet: nothing to do.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      this.shared.set('copied');
      setTimeout(() => this.shared.set(null), 2500);
    } catch {
      // No clipboard access: the address bar still has the link.
    }
  }
}
