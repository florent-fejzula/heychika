import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { landedCosts, weightedAverage } from '../../core/costing';
import { formatCode, formatMoney, parseAmount, parseRate } from '../../core/money';
import { PurchaseInput, PurchaseLine, PurchaseRow, PurchaseCurrency, Purchases } from '../../core/purchases';
import { BarcodeLinker, LinkableSize, isLinked } from '../shared/barcode-linker';

interface Row {
  line: PurchaseLine;
  landed: number;
  /** Set when there is already stock of this size and the new cost would change its average. */
  averageNote: string | null;
}

interface Group {
  id: number;
  name: string;
  qty: number;
  rows: Row[];
}

const PROBLEMS = {
  no_items: 'Add some items first.',
  zero_value: 'Trip costs can’t be spread by price when every item is free. Spread them equally instead.',
} as const;

const blankToNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

@Component({
  selector: 'app-purchase-editor',
  imports: [ReactiveFormsModule, RouterLink, BarcodeLinker],
  templateUrl: './purchase-editor.html',
  styleUrl: './purchase-editor.scss',
})
export class PurchaseEditor {
  private readonly purchases = inject(Purchases);
  private readonly router = inject(Router);

  /** From the route (`stock/purchases/:id`). Absent on `stock/purchases/new`. */
  readonly id = input<string>();
  /** `?added=Wrap dress: 6 items`, after the Add item form. */
  readonly added = input<string>();
  /** `?photos=2`: photos that didn't upload. */
  readonly photos = input<string>();

  protected readonly showLinker = signal(false);

  /** Every size on the trip, for linking the barcodes on their tags. */
  protected readonly linkable = computed<LinkableSize[]>(() =>
    this.lines().map((l) => ({
      variantId: l.variant_id,
      design: l.variant.product.name,
      colour: l.variant.color.name,
      size: l.variant.size.label,
      sku: l.variant.sku,
      barcode: l.variant.barcode,
    })),
  );
  protected readonly unlinkedCount = computed(() => this.linkable().filter((s) => !isLinked(s)).length);

  protected readonly isNew = computed(() => this.id() === undefined);
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly loadError = signal('');
  protected readonly saving = signal(false);
  protected readonly receiving = signal(false);
  protected readonly justReceived = signal(false);
  protected readonly receiveError = signal<string | null>(null);
  protected readonly message = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);

  protected readonly purchase = signal<PurchaseRow | null>(null);
  protected readonly lines = signal<PurchaseLine[]>([]);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    reference: ['', [Validators.required, Validators.maxLength(80)]],
    supplier_name: [''],
    purchase_date: [new Date().toISOString().slice(0, 10), Validators.required],
    currency: ['EUR' as PurchaseCurrency],
    rate: ['1'],
    extra: ['0'],
    method: ['by_quantity' as PurchaseRow['allocation_method']],
    notes: [''],
  });
  protected readonly formCurrency = toSignal(this.form.controls.currency.valueChanges, { initialValue: 'EUR' as PurchaseCurrency });

  protected readonly isDraft = computed(() => this.purchase()?.status === 'draft');

  /** The preview, worked out from the saved trip (not unsaved edits), so what is shown is what will be stored. */
  protected readonly cost = computed(() => {
    const p = this.purchase();
    if (!p) return null;
    return landedCosts(
      this.lines().map((l) => ({ qty: l.qty, unitPrice: Number(l.unit_price) })),
      { currencyPerEur: Number(p.currency_per_eur), extraCostsEur: Number(p.extra_costs_eur), method: p.allocation_method },
    );
  });

  protected readonly groups = computed<Group[]>(() => {
    const p = this.purchase();
    const cost = this.cost();
    const received = p?.status === 'received';
    const byProduct = new Map<number, Group>();

    this.lines().forEach((line, i) => {
      const landed = received ? Number(line.unit_landed_cost_eur) : (cost?.lines[i]?.landedEur ?? 0);
      const g = byProduct.get(line.variant.product.id) ?? { id: line.variant.product.id, name: line.variant.product.name, qty: 0, rows: [] };
      g.qty += line.qty;
      g.rows.push({ line, landed, averageNote: received ? null : this.averageNote(line, landed) });
      byProduct.set(g.id, g);
    });

    return [...byProduct.values()]
      .map((g) => ({
        ...g,
        rows: g.rows.sort((a, b) => a.line.variant.color.name.localeCompare(b.line.variant.color.name) || a.line.variant.size.sort_order - b.line.variant.size.sort_order),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  protected readonly summary = computed(() => {
    const p = this.purchase();
    const cost = this.cost();
    if (!p || !cost || !this.lines().length) return null;

    const received = p.status === 'received';
    const total = received
      ? this.lines().reduce((sum, l) => sum + l.qty * Number(l.unit_landed_cost_eur), 0)
      : cost.lines.reduce((sum, l, i) => sum + l.landedEur * this.lines()[i].qty, 0);

    return {
      items: cost.totalQty,
      goods: formatCode(this.lines().reduce((s, l) => s + l.qty * Number(l.unit_price), 0), p.currency),
      goodsEur: formatMoney(cost.goodsEur, 'EUR'),
      foreign: p.currency !== 'EUR',
      trip: formatMoney(Number(p.extra_costs_eur), 'EUR'),
      total: formatMoney(total, 'EUR'),
      average: formatMoney(cost.totalQty ? total / cost.totalQty : 0, 'EUR'),
      problem: cost.problem ? PROBLEMS[cost.problem] : null,
    };
  });

  /** True while the form has edits that are not saved yet. */
  protected readonly dirty = signal(false);

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.load(id));
    });
    this.form.valueChanges.subscribe(() => this.dirty.set(this.form.dirty));

    // Euros are always 1 euro per euro; there is nothing to type.
    this.form.controls.currency.valueChanges.subscribe((c) => {
      if (c === 'EUR') this.form.controls.rate.setValue('1', { emitEvent: false });
      else if (this.form.controls.rate.value === '1') this.form.controls.rate.setValue('');
    });
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    const v = this.form.getRawValue();
    const rate = v.currency === 'EUR' ? 1 : parseRate(v.rate);
    const extra = parseAmount(v.extra);

    if (!v.reference.trim()) return this.fail('Give the trip a name, like “Istanbul, October”.');
    if (!v.purchase_date) return this.fail('Pick the date.');
    if (rate === null) return this.fail(`Enter the exchange rate: how many ${v.currency} equal €1 (for example ${v.currency === 'TRY' ? '38.5' : '1.08'}).`);
    if (extra === null) return this.fail('Enter the trip costs in euros, or 0 if there were none.');

    const input: PurchaseInput = {
      reference: v.reference.trim(),
      supplier_name: blankToNull(v.supplier_name),
      purchase_date: v.purchase_date,
      currency: v.currency,
      currency_per_eur: rate,
      extra_costs_eur: extra,
      allocation_method: v.method,
      notes: blankToNull(v.notes),
    };

    this.saving.set(true);
    this.message.set(null);
    try {
      if (this.isNew()) {
        const newId = await this.purchases.create(input);
        // Straight on to what was bought: that's what she came to enter.
        await this.router.navigate(['/admin/stock/purchases', newId, 'add']);
      } else {
        await this.purchases.update(this.purchase()!.id, input);
        this.purchase.set(await this.purchases.get(this.purchase()!.id));
        this.form.markAsPristine();
        this.dirty.set(false);
        this.message.set({ kind: 'ok', text: 'Saved.' });
      }
    } catch (e) {
      this.fail((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }

  protected async removeLine(line: PurchaseLine): Promise<void> {
    await this.guarded(async () => {
      await this.purchases.removeLines(line.purchase_id, [line.variant_id]);
      this.lines.set(await this.purchases.lines(line.purchase_id));
    });
  }

  protected async reloadLines(): Promise<void> {
    const p = this.purchase();
    if (p) this.lines.set(await this.purchases.lines(p.id));
  }

  protected async receive(): Promise<void> {
    const p = this.purchase();
    const s = this.summary();
    if (!p || !s || this.receiving()) return;
    if (!confirm(`Put ${s.items} ${s.items === 1 ? 'item' : 'items'} on the shelf?\n\nTheir cost is fixed at ${s.average} each on average. This can’t be undone.`)) return;

    this.receiving.set(true);
    this.receiveError.set(null);
    try {
      await this.purchases.receive(p.id);
      await this.load(String(p.id));
      this.justReceived.set(true);
    } catch (e) {
      this.receiveError.set((e as Error).message);
    } finally {
      this.receiving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const p = this.purchase();
    if (!p || !confirm(`Delete the draft “${p.reference}” and everything entered on it?`)) return;
    await this.guarded(async () => {
      await this.purchases.remove(p.id);
      await this.router.navigateByUrl('/admin/stock/purchases');
    });
  }

  protected money(n: number | null, code = 'EUR'): string {
    return formatCode(Number(n ?? 0), code);
  }

  protected date(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  protected readonly methodLabel = (m: PurchaseRow['allocation_method']): string =>
    m === 'by_quantity' ? 'Equally per item' : 'By price (dearer items carry more)';

  private averageNote(line: PurchaseLine, landed: number): string | null {
    const onHand = line.variant.stock?.qty_physical ?? 0;
    const cost = Number(line.variant.cost_eur);
    if (onHand <= 0 || cost <= 0) return null;
    const after = weightedAverage(cost, onHand, landed, line.qty);
    return after === cost ? null : `average cost ${formatMoney(cost, 'EUR')} → ${formatMoney(after, 'EUR')} (${onHand} already on the shelf)`;
  }

  private fail(text: string): void {
    this.message.set({ kind: 'error', text });
  }

  private async guarded(action: () => Promise<void>): Promise<void> {
    this.message.set(null);
    try {
      await action();
    } catch (e) {
      this.fail((e as Error).message);
    }
  }

  private async load(id: string | undefined): Promise<void> {
    this.state.set('loading');
    this.message.set(null);
    this.justReceived.set(false);
    try {
      if (id === undefined) {
        this.purchase.set(null);
        this.lines.set([]);
        this.form.reset();
        this.dirty.set(false);
        this.state.set('ready');
        return;
      }

      const p = /^\d+$/.test(id) ? await this.purchases.get(Number(id)) : null;
      if (!p) {
        this.state.set('missing');
        return;
      }
      this.purchase.set(p);
      this.lines.set(await this.purchases.lines(p.id));
      this.form.reset({
        reference: p.reference,
        supplier_name: p.supplier_name ?? '',
        purchase_date: p.purchase_date,
        currency: p.currency,
        rate: String(p.currency_per_eur),
        extra: String(p.extra_costs_eur),
        method: p.allocation_method,
        notes: p.notes ?? '',
      });
      this.dirty.set(false);
      this.state.set('ready');
    } catch (e) {
      this.loadError.set((e as Error).message);
      this.state.set('error');
    }
  }
}
