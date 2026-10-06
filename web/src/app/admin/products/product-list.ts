import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Catalogue, ProductStatus, ProductSummary } from '../../core/catalogue';
import { TranslatePipe } from '../../core/i18n';
import { formatMoney } from '../../core/money';

@Component({
  selector: 'app-product-list',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './product-list.html',
  styleUrl: './product-list.scss',
})
export class ProductList {
  private readonly catalogue = inject(Catalogue);

  protected readonly products = signal<ProductSummary[] | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly search = signal('');
  protected readonly category = signal('');
  protected readonly status = signal<'' | ProductStatus>('');

  protected readonly categories = computed(() => {
    const seen = new Map<string, string>();
    for (const p of this.products() ?? []) seen.set(p.category.code, p.category.name);
    return [...seen].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
  });

  // Archived designs are hidden unless asked for: they're finished with, not deleted.
  protected readonly shown = computed(() => {
    const q = this.search().trim().toLowerCase();
    const category = this.category();
    const status = this.status();
    return (this.products() ?? []).filter((p) => {
      if (status ? p.status !== status : p.status === 'archived') return false;
      if (category && p.category.code !== category) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        `${p.category.code}-${p.model_code}`.toLowerCase().includes(q) ||
        p.category.name.toLowerCase().includes(q)
      );
    });
  });

  constructor() {
    this.catalogue
      .listProducts()
      .then((p) => this.products.set(p))
      .catch((e: Error) => this.error.set(e.message));
  }

  protected code(p: ProductSummary): string {
    return `${p.category.code}-${p.model_code}`;
  }

  protected cover(p: ProductSummary): string | null {
    const image = p.images.find((i) => i.is_primary) ?? [...p.images].sort((a, b) => a.sort_order - b.sort_order)[0];
    return image ? this.catalogue.imageUrl(image.storage_path, true) : null;
  }

  protected units(p: ProductSummary): number {
    return p.variants.reduce((sum, v) => sum + (v.stock?.qty_physical ?? 0), 0);
  }

  protected price(p: ProductSummary): string {
    const prices = p.variants.filter((v) => v.active).map((v) => Number(v.price_eur));
    if (!prices.length) return '';
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    return low === high ? formatMoney(low, 'EUR') : `${formatMoney(low, 'EUR')} – ${formatMoney(high, 'EUR')}`;
  }

  protected setStatus(value: string): void {
    this.status.set(value as '' | ProductStatus);
  }
}
