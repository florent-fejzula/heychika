import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { COUNTRY_CURRENCY, COUNTRY_NAME, Country, DeliveryZone, FxSettings, formatMoney, localPrice, parseAmount } from '../../core/money';
import { Customer, OrderDetail, Orders, SellableItem } from '../../core/orders';
import { Scanner } from '../shared/scanner';

interface Line {
  item: SellableItem;
  qty: number;
  /** A price typed in, in the order's currency. Empty for the usual price (or the one already on the order). */
  priceText: string;
  /** On an order being edited: the price it already has, kept unless changed. */
  kept: number | null;
  /** On an order being edited: how many it already holds, which count as available to it. */
  held: number;
}

const COUNTRIES: Country[] = ['XK', 'MK', 'AL'];

interface CustomerForm {
  first_name: string;
  last_name: string;
  phone: string;
  city: string;
  address: string;
  postal_code: string;
}

/**
 * Two jobs, one screen:
 *   /admin/orders/new        an order agreed in a DM, typed in as fast as possible
 *   /admin/orders/:id/items  changing what's on an order before it's sent
 */
@Component({
  selector: 'app-order-editor',
  imports: [RouterLink, Scanner],
  templateUrl: './order-editor.html',
  styleUrl: './order-editor.scss',
})
export class OrderEditor {
  private readonly orders = inject(Orders);
  private readonly router = inject(Router);

  /** Present when changing an existing order's items. */
  readonly id = input<string>();

  protected readonly isNew = computed(() => this.id() === undefined);
  protected readonly state = signal<'loading' | 'ready' | 'error' | 'locked'>('loading');
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly fx = signal<FxSettings | null>(null);
  private readonly zones = signal<DeliveryZone[]>([]);
  private readonly catalogue = signal<SellableItem[]>([]);
  protected readonly existing = signal<OrderDetail | null>(null);

  // Customer (new orders only)
  protected readonly countries = COUNTRIES.map((c) => ({ code: c, name: COUNTRY_NAME[c], currency: COUNTRY_CURRENCY[c] }));
  protected readonly country = signal<Country>('XK');
  protected readonly customerId = signal<number | null>(null);
  protected readonly customer = signal<CustomerForm>({ first_name: '', last_name: '', phone: '', city: '', address: '', postal_code: '' });
  protected readonly matches = signal<Customer[]>([]);
  private lookupTimer: ReturnType<typeof setTimeout> | undefined;

  // Items
  protected readonly lines = signal<Line[]>([]);
  protected readonly search = signal('');
  protected readonly openDesign = signal<number | null>(null);
  protected readonly showScanner = signal(false);
  protected readonly scanNote = signal<string | null>(null);

  // Delivery and notes
  protected readonly feeText = signal('');
  protected readonly notes = signal('');

  protected readonly currency = computed(() => this.existing()?.currency ?? COUNTRY_CURRENCY[this.country()]);

  /** Designs matching the search, each with its sizes. */
  protected readonly designs = computed(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return [];
    const byDesign = new Map<number, { id: number; name: string; items: SellableItem[] }>();
    for (const item of this.catalogue()) {
      if (!item.product.name.toLowerCase().includes(q) && !item.sku.toLowerCase().includes(q)) continue;
      const d = byDesign.get(item.product.id) ?? { id: item.product.id, name: item.product.name, items: [] };
      d.items.push(item);
      byDesign.set(item.product.id, d);
    }
    return [...byDesign.values()].slice(0, 12);
  });

  protected readonly usualFee = computed(() => {
    const fx = this.fx();
    const zone = this.zones().find((z) => z.country === (this.existing()?.country ?? this.country()));
    if (!fx || !zone) return 0;
    const subtotal = this.lines().reduce((sum, l) => sum + l.qty * l.item.price_eur, 0);
    const free = zone.free_over_eur !== null && subtotal >= zone.free_over_eur;
    return free ? 0 : localPrice(zone.fee_eur, zone.currency, fx);
  });

  protected readonly fee = computed(() => {
    const typed = this.feeText().trim();
    return typed === '' ? this.usualFee() : parseAmount(typed);
  });

  protected readonly itemsTotal = computed(() =>
    this.lines().reduce((sum, l) => sum + l.qty * (this.unitPrice(l) ?? 0), 0));

  protected readonly total = computed(() => this.itemsTotal() + (this.fee() ?? 0));
  protected readonly count = computed(() => this.lines().reduce((n, l) => n + l.qty, 0));

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.lookupTimer));
    effect(() => {
      const id = this.id();
      untracked(() => this.load(id));
    });
  }

  // ---------------------------------------------------------------- display

  protected money(amount: number): string {
    return formatMoney(amount, this.currency());
  }

  /** The usual price of an item in this order's currency. */
  protected usual(item: SellableItem): number {
    const fx = this.fx();
    return fx ? localPrice(item.price_eur, this.currency(), fx) : item.price_eur;
  }

  /** The price a line will be charged at, or null when what's typed isn't a price. */
  protected unitPrice(l: Line): number | null {
    if (l.priceText.trim()) return parseAmount(l.priceText);
    return l.kept ?? this.usual(l.item);
  }

  protected left(item: SellableItem): number {
    const line = this.lines().find((l) => l.item.id === item.id);
    return item.available + (line?.held ?? 0) - (line?.qty ?? 0);
  }

  // ---------------------------------------------------------------- customer

  protected setCustomer(field: keyof CustomerForm, value: string): void {
    this.customer.update((c) => ({ ...c, [field]: value }));
    if (field === 'phone') {
      this.customerId.set(null);
      clearTimeout(this.lookupTimer);
      this.lookupTimer = setTimeout(() => this.lookup(value), 300);
    }
  }

  /** A repeat customer: fill in everything from last time. */
  protected pick(c: Customer): void {
    this.customerId.set(c.id);
    this.country.set(c.country);
    this.customer.set({
      first_name: c.first_name, last_name: c.last_name, phone: c.phone,
      city: c.city, address: c.address, postal_code: c.postal_code ?? '',
    });
    this.matches.set([]);
  }

  private async lookup(phone: string): Promise<void> {
    try {
      this.matches.set(await this.orders.findByPhone(phone));
    } catch {
      this.matches.set([]);
    }
  }

  // ---------------------------------------------------------------- items

  protected add(item: SellableItem): void {
    const existing = this.lines().find((l) => l.item.id === item.id);
    if (existing) {
      this.setQty(existing, existing.qty + 1);
    } else {
      this.lines.update((ls) => [...ls, { item, qty: 1, priceText: '', kept: null, held: 0 }]);
    }
    this.error.set(null);
  }

  protected onScan(code: string): void {
    const c = code.trim().toUpperCase();
    const item = this.catalogue().find((i) => i.barcode.toUpperCase() === c || i.sku.toUpperCase() === c);
    if (!item) {
      this.scanNote.set(`Nothing for sale matches ${code.trim()}.`);
      return;
    }
    this.add(item);
    this.scanNote.set(`Added ${item.product.name}, ${item.color.name} ${item.size.label}.`);
  }

  protected setQty(line: Line, qty: number): void {
    if (qty <= 0) {
      this.remove(line);
      return;
    }
    this.lines.update((ls) => ls.map((l) => (l === line ? { ...l, qty: Math.min(99, qty) } : l)));
  }

  protected setPrice(line: Line, text: string): void {
    this.lines.update((ls) => ls.map((l) => (l === line ? { ...l, priceText: text } : l)));
  }

  protected remove(line: Line): void {
    this.lines.update((ls) => ls.filter((l) => l !== line));
  }

  // ---------------------------------------------------------------- save

  protected async save(): Promise<void> {
    if (this.busy()) return;
    this.error.set(null);

    if (!this.lines().length) {
      this.error.set('Add at least one item.');
      return;
    }
    const bad = this.lines().find((l) => this.unitPrice(l) === null);
    if (bad) {
      this.error.set(`The price for ${bad.item.product.name} isn’t a number.`);
      return;
    }
    if (this.fee() === null) {
      this.error.set('The delivery fee isn’t a number.');
      return;
    }
    const lines = this.lines().map((l) => ({
      variant_id: l.item.id,
      qty: l.qty,
      price: l.priceText.trim() ? parseAmount(l.priceText) : null,
    }));
    const fee = this.feeText().trim() ? this.fee() : null;

    if (this.isNew()) {
      const c = this.customer();
      const missing = !c.first_name.trim() ? 'the name' : !c.phone.trim() ? 'a phone number' : !c.city.trim() ? 'the town' : !c.address.trim() ? 'the address' : null;
      if (missing) {
        this.error.set(`Fill in ${missing}.`);
        return;
      }
    }

    this.busy.set(true);
    try {
      if (this.isNew()) {
        const c = this.customer();
        const created = await this.orders.createManual(
          this.country(),
          { ...(this.customerId() ? { id: this.customerId()! } : {}), ...c },
          lines,
          fee,
          this.notes().trim(),
        );
        await this.router.navigate(['/admin/orders', created.id]);
      } else {
        const id = this.existing()!.id;
        await this.orders.editItems(id, lines, fee);
        await this.router.navigate(['/admin/orders', id]);
      }
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  private async load(id: string | undefined): Promise<void> {
    this.state.set('loading');
    try {
      const [pricing, catalogue, order] = await Promise.all([
        this.orders.pricing(),
        this.orders.sellable(),
        id !== undefined ? this.orders.get(Number(id)) : Promise.resolve(null),
      ]);
      this.fx.set(pricing.fx);
      this.zones.set(pricing.zones);
      this.catalogue.set(catalogue);

      if (id !== undefined) {
        if (!order || !['new', 'confirmed'].includes(order.status)) {
          this.existing.set(order);
          this.state.set('locked');
          return;
        }
        this.existing.set(order);
        const byId = new Map(catalogue.map((i) => [i.id, i]));
        this.lines.set(
          order.lines
            .filter((l) => byId.has(l.variant_id))
            .map((l) => ({
              item: byId.get(l.variant_id)!,
              qty: l.qty,
              priceText: '',
              kept: l.unit_price_in_currency,
              held: l.qty,
            })),
        );
        this.feeText.set(String(order.delivery_fee_in_currency));
      }
      this.state.set('ready');
    } catch (e) {
      this.loadError.set((e as Error).message);
      this.state.set('error');
    }
  }
}
