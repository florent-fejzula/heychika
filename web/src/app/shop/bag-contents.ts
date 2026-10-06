import { Injectable, computed, inject, signal } from '@angular/core';
import { Bag, MAX_PER_ITEM } from './bag';
import { named, t } from '../core/i18n';
import { BagTotals, bagTotals } from '../core/money';
import { BagItem, ShopApi } from './shop-api';
import { ShopState } from './shop-state';

export interface BagRow {
  item: BagItem;
  qty: number;
  /** The most this line can go up to: what's in stock, within the per-item limit. */
  max: number;
}

/**
 * The bag as it stands in the shop right now: names, current prices, current
 * stock. Shared by the bag page and checkout.
 *
 * Loading it also tidies the bag: anything taken off sale or sold out is
 * removed, and quantities above what's left are lowered, each with a note
 * saying so. Better she reads that here than at the door.
 */
@Injectable({ providedIn: 'root' })
export class BagContents {
  private readonly bag = inject(Bag);
  private readonly api = inject(ShopApi);
  private readonly shop = inject(ShopState);

  readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  readonly notices = signal<string[]>([]);
  private readonly items = signal<BagItem[]>([]);

  readonly rows = computed<BagRow[]>(() => {
    const byId = new Map(this.items().map((i) => [i.variantId, i]));
    return this.bag
      .lines()
      .filter((l) => byId.has(l.variantId))
      .map((l) => {
        const item = byId.get(l.variantId)!;
        return { item, qty: l.qty, max: Math.min(item.available, MAX_PER_ITEM) };
      });
  });

  readonly totals = computed<BagTotals | null>(() => {
    const zone = this.shop.zone();
    if (!zone) return null;
    return bagTotals(
      this.rows().map((r) => ({ priceEur: r.item.priceEur, qty: r.qty })),
      zone,
      this.shop.fx(),
    );
  });

  async load(): Promise<void> {
    this.bag.restore();
    this.notices.set([]);
    const ids = this.bag.lines().map((l) => l.variantId);
    if (!ids.length) {
      this.items.set([]);
      this.state.set('ready');
      return;
    }

    this.state.set('loading');
    try {
      const items = await this.api.bagItems(ids);
      this.items.set(items);
      this.notices.set(this.tidy(items));
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  /** After checkout says something sold out in the meantime. */
  async reload(note: string): Promise<void> {
    await this.load();
    this.notices.update((n) => [note, ...n]);
  }

  private tidy(items: BagItem[]): string[] {
    const notes: string[] = [];
    const byId = new Map(items.map((i) => [i.variantId, i]));
    let gone = 0;

    for (const line of this.bag.lines()) {
      const item = byId.get(line.variantId);
      if (!item) {
        gone++;
        this.bag.remove(line.variantId);
      } else if (item.available === 0) {
        notes.push(t('shop.bag.soldOutNote', { item: describe(item) }));
        this.bag.remove(line.variantId);
      } else if (line.qty > item.available) {
        notes.push(t('shop.bag.fewerNote', { item: describe(item), count: item.available }));
        this.bag.set(line.variantId, item.available);
      }
    }
    if (gone) {
      notes.unshift(t('shop.bag.goneNote', { count: gone }));
    }
    return notes;
  }
}

export function describe(item: BagItem): string {
  return `${item.product.name} (${named(item.color.name, item.color.name_sq)}, ${named(item.size, item.size_sq)})`;
}
