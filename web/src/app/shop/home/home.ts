import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Loaded } from '../resolvers';
import { ShopApi, ShopProduct, slugify } from '../shop-api';
import { ShopState } from '../shop-state';

interface Card {
  slug: string;
  name: string;
  image: string | null;
  priceEur: number;
  /** True when sizes or colours are priced differently, so the card says "from". */
  priceVaries: boolean;
  wasEur: number | null;
  colours: { name: string; hex: string | null }[];
  soldOut: boolean;
  featured: boolean;
  colourQuery: string | null;
}

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private readonly api = inject(ShopApi);
  private readonly router = inject(Router);
  protected readonly shop = inject(ShopState);

  // From the resolver and the query string (?category=dresses&size=M&colour=black).
  readonly products = input.required<Loaded<ShopProduct[]>>();
  readonly category = input<string>();
  readonly size = input<string>();
  readonly colour = input<string>();

  protected readonly failed = computed(() => !this.products().ok);
  private readonly all = computed(() => {
    const p = this.products();
    return p.ok ? p.value : [];
  });

  /** Only categories that have something in them. */
  protected readonly categories = computed(() => {
    const used = new Set(this.all().map((p) => p.category.id));
    return (this.shop.context()?.categories ?? []).filter((c) => used.has(c.id));
  });

  private readonly inCategory = computed(() => {
    const slug = this.category();
    return slug ? this.all().filter((p) => slugify(p.category.name) === slug) : this.all();
  });

  /** Sizes and colours on offer in the chosen category, in their natural order. */
  protected readonly sizes = computed(() => uniqueBy(
    this.inCategory().flatMap((p) => p.variants.map((v) => v.size)),
    (s) => s.label,
  ).sort((a, b) => a.sort_order - b.sort_order).map((s) => s.label));

  protected readonly colours = computed(() => uniqueBy(
    this.inCategory().flatMap((p) => p.variants.map((v) => v.color)),
    (c) => c.id,
  ).sort((a, b) => a.sort_order - b.sort_order).map((c) => ({ name: c.name, slug: slugify(c.name) })));

  protected readonly filtering = computed(() => !!(this.category() || this.size() || this.colour()));

  protected readonly cards = computed<Card[]>(() => {
    const size = this.size();
    const colour = this.colour();

    return this.inCategory()
      .map((p) => {
        // A size or colour filter means "show me what I can actually buy in it".
        const matching = p.variants.filter(
          (v) => (!size || v.size.label === size) && (!colour || slugify(v.color.name) === colour),
        );
        if ((size || colour) && !matching.some((v) => v.available > 0)) return null;
        return this.card(p, matching.length ? matching : p.variants, colour ?? null);
      })
      .filter((c): c is Card => c !== null)
      // In stock first, then the ones she chose to feature, then newest first (the order they arrive in).
      .sort((a, b) => Number(a.soldOut) - Number(b.soldOut) || Number(b.featured) - Number(a.featured));
  });

  protected readonly categoryName = computed(
    () => this.categories().find((c) => c.slug === this.category())?.name ?? null,
  );

  protected filter(key: 'size' | 'colour', value: string): void {
    this.router.navigate(['/'], { queryParams: { [key]: value || null }, queryParamsHandling: 'merge' });
  }

  private card(p: ShopProduct, variants: ShopProduct['variants'], colour: string | null): Card {
    const inStock = variants.filter((v) => v.available > 0);
    const priced = inStock.length ? inStock : variants;
    const cheapest = priced.reduce((a, b) => (b.price_eur < a.price_eur ? b : a));
    const image = (colour && p.images.find((i) => variants.some((v) => v.color.id === i.color_id))) || p.images[0];

    return {
      slug: p.slug,
      name: p.name,
      image: image ? this.api.imageUrl(image.storage_path, true) : null,
      priceEur: cheapest.price_eur,
      priceVaries: new Set(priced.map((v) => v.price_eur)).size > 1,
      wasEur: cheapest.compare_at_price_eur && cheapest.compare_at_price_eur > cheapest.price_eur ? cheapest.compare_at_price_eur : null,
      colours: uniqueBy(p.variants.map((v) => v.color), (c) => c.id).map((c) => ({ name: c.name, hex: c.hex })),
      soldOut: !p.variants.some((v) => v.available > 0),
      featured: p.featured,
      colourQuery: colour,
    };
  }
}

function uniqueBy<T, K>(items: T[], key: (item: T) => K): T[] {
  const seen = new Map<K, T>();
  for (const item of items) if (!seen.has(key(item))) seen.set(key(item), item);
  return [...seen.values()];
}
