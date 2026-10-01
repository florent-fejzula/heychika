import { Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Inventory, MOVEMENT_LABEL, Movement, StockRow } from '../../core/inventory';
import { formatMoney, parseCount } from '../../core/money';

const NEEDS_REASON = 'Say why, so the history makes sense later.';

// Everything that can be done to one size's stock, plus how its stock got to where it is.
@Component({
  selector: 'app-stock-detail',
  imports: [RouterLink],
  templateUrl: './stock-detail.html',
  styleUrl: './stock-detail.scss',
})
export class StockDetail {
  private readonly inventory = inject(Inventory);

  readonly row = input.required<StockRow>();
  readonly changed = output<void>();

  protected readonly history = signal<Movement[] | null>(null);
  protected readonly people = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly busy = signal(false);
  protected readonly message = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);

  protected readonly count = signal('');
  protected readonly countReason = signal('');
  protected readonly damagedQty = signal('1');
  protected readonly damagedReason = signal('');
  protected readonly writeOffQty = signal('');
  protected readonly writeOffReason = signal('');
  protected readonly minStock = signal('');

  constructor() {
    // Start each panel from what is true now, and reload the history when the item changes.
    effect(() => {
      const row = this.row();
      untracked(() => {
        this.count.set(String(row.stock?.qty_physical ?? 0));
        this.minStock.set(String(row.stock?.min_stock ?? 0));
        this.writeOffQty.set(String(row.stock?.qty_damaged ?? 0));
        void this.loadHistory(row.id);
      });
    });
  }

  protected get shelf(): number {
    return this.row().stock?.qty_physical ?? 0;
  }

  protected get damaged(): number {
    return this.row().stock?.qty_damaged ?? 0;
  }

  /** What the recount would change, shown before it is saved. */
  protected get recountDelta(): number | null {
    const n = parseCount(this.count());
    return n === null ? null : n - this.shelf;
  }

  protected async recount(): Promise<void> {
    const target = parseCount(this.count());
    if (target === null) return this.fail('Enter how many are on the shelf, as a whole number.');
    const delta = target - this.shelf;
    if (delta === 0) return this.fail(`The system already says ${target}. Nothing to change.`);
    const reason = this.reason(this.countReason());
    if (!reason) return this.fail(NEEDS_REASON);

    await this.run(`Count corrected to ${target}.`, () => this.inventory.adjust(this.row().id, delta, reason), () => this.countReason.set(''));
  }

  protected async markDamaged(): Promise<void> {
    const qty = parseCount(this.damagedQty());
    if (!qty) return this.fail('Enter how many are damaged.');
    if (qty > this.shelf) return this.fail(`Only ${this.shelf} on the shelf.`);
    const reason = this.reason(this.damagedReason());
    if (!reason) return this.fail(NEEDS_REASON);

    await this.run(`${qty} marked damaged. They no longer count as for sale.`, () => this.inventory.markDamaged(this.row().id, qty, reason), () => {
      this.damagedReason.set('');
      this.damagedQty.set('1');
    });
  }

  protected async writeOff(): Promise<void> {
    const qty = parseCount(this.writeOffQty());
    if (!qty) return this.fail('Enter how many to write off.');
    if (qty > this.damaged) return this.fail(`Only ${this.damaged} damaged.`);
    const reason = this.reason(this.writeOffReason());
    if (!reason) return this.fail(NEEDS_REASON);

    await this.run(`${qty} written off.`, () => this.inventory.writeOff(this.row().id, qty, reason), () => this.writeOffReason.set(''));
  }

  protected async saveMin(): Promise<void> {
    const min = parseCount(this.minStock());
    if (min === null) return this.fail('Enter a whole number. 0 turns the warning off.');
    await this.run(min === 0 ? 'Low-stock warning turned off.' : `You’ll be warned at ${min} or fewer.`, () => this.inventory.setMinStock(this.row().id, min));
  }

  protected label(m: Movement): string {
    return MOVEMENT_LABEL[m.type];
  }

  /** The non-zero changes of one movement, like “shelf −2 · on the road +2”. */
  protected effects(m: Movement): string {
    const parts: [string, number][] = [
      ['shelf', m.delta_physical],
      ['reserved', m.delta_reserved],
      ['on the road', m.delta_in_transit],
      ['damaged', m.delta_damaged],
    ];
    return parts
      .filter(([, n]) => n !== 0)
      .map(([name, n]) => `${name} ${n > 0 ? '+' : '−'}${Math.abs(n)}`)
      .join(' · ');
  }

  protected who(m: Movement): string {
    return (m.user_id && this.people().get(m.user_id)) || '';
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  protected money(n: number): string {
    return formatMoney(Number(n), 'EUR');
  }

  private reason(text: string): string | null {
    const t = text.trim();
    return t ? t : null;
  }

  private fail(text: string): void {
    this.message.set({ kind: 'error', text });
  }

  private async run(done: string, action: () => Promise<void>, after?: () => void): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      await action();
      after?.();
      this.message.set({ kind: 'ok', text: done });
      this.changed.emit();
    } catch (e) {
      this.message.set({ kind: 'error', text: (e as Error).message });
    } finally {
      this.busy.set(false);
    }
  }

  private async loadHistory(id: number): Promise<void> {
    try {
      const [history, people] = await Promise.all([this.inventory.history(id), this.inventory.people()]);
      this.history.set(history);
      this.people.set(people);
    } catch (e) {
      this.history.set([]);
      this.message.set({ kind: 'error', text: (e as Error).message });
    }
  }
}
