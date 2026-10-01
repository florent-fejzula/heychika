import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface BagLine {
  variantId: number;
  qty: number;
}

/** Matches the limit in public.place_order. */
export const MAX_PER_ITEM = 5;

const KEY = 'hc_bag';

function valid(value: unknown): value is BagLine[] {
  return (
    Array.isArray(value) &&
    value.every((l) => Number.isInteger(l?.variantId) && Number.isInteger(l?.qty) && l.qty > 0)
  );
}

/**
 * What the customer means to buy: variant ids and quantities, nothing else.
 * Names, prices and stock are looked up fresh whenever the bag is shown, so a
 * bag left open for a week never shows last week's price.
 *
 * Kept in this browser's local storage. If that's unavailable (private mode,
 * blocked site data) the bag still works for the visit, it just isn't remembered.
 */
@Injectable({ providedIn: 'root' })
export class Bag {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private restored = false;

  readonly lines = signal<BagLine[]>([]);
  readonly count = computed(() => this.lines().reduce((n, l) => n + l.qty, 0));

  /**
   * Loads the saved bag. Called after the first render, not at start-up: the
   * server always renders an empty bag, and the page has to match it while it
   * hydrates. Safe to call more than once.
   */
  restore(): void {
    if (!this.browser || this.restored) return;
    this.restored = true;
    this.lines.set(this.read());
    // Another tab added something: keep this one in step.
    window.addEventListener('storage', (e) => {
      if (e.key === KEY) this.lines.set(this.read());
    });
  }

  qtyOf(variantId: number): number {
    return this.lines().find((l) => l.variantId === variantId)?.qty ?? 0;
  }

  /** Adds to what's already there, up to the per-item limit. Returns the quantity now in the bag. */
  add(variantId: number, qty = 1): number {
    const next = Math.min(MAX_PER_ITEM, this.qtyOf(variantId) + qty);
    this.set(variantId, next);
    return next;
  }

  set(variantId: number, qty: number): void {
    const clamped = Math.max(0, Math.min(MAX_PER_ITEM, Math.floor(qty)));
    const others = this.lines().filter((l) => l.variantId !== variantId);
    const exists = this.lines().some((l) => l.variantId === variantId);
    if (clamped === 0) {
      this.write(others);
    } else if (exists) {
      this.write(this.lines().map((l) => (l.variantId === variantId ? { variantId, qty: clamped } : l)));
    } else {
      this.write([...this.lines(), { variantId, qty: clamped }]);
    }
  }

  remove(variantId: number): void {
    this.set(variantId, 0);
  }

  clear(): void {
    this.write([]);
  }

  private read(): BagLine[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
      return valid(parsed) ? parsed.map((l) => ({ variantId: l.variantId, qty: Math.min(MAX_PER_ITEM, l.qty) })) : [];
    } catch {
      return [];
    }
  }

  private write(lines: BagLine[]): void {
    this.lines.set(lines);
    if (!this.browser) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(lines));
    } catch {
      // Storage full or blocked: the bag still works until the page is closed.
    }
  }
}
