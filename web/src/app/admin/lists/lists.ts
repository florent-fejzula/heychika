import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Catalogue, Category, Colour, Size, SizeType } from '../../core/catalogue';
import { explain } from '../../core/errors';
import { Supabase } from '../../core/supabase';

type Kind = 'categories' | 'colors' | 'sizes';

const SIZE_TYPE_LABEL: Record<SizeType, string> = { letter: 'Letters (S, M, L)', numeric: 'Numbers (36, 38)', one_size: 'One size' };

// Codes become part of every SKU, so they follow the same rules the database enforces
// (and the database refuses to change one once something uses it).
const CODE_RULE: Record<Kind, { pattern: RegExp; hint: string }> = {
  categories: { pattern: /^[A-Z]{2,3}$/, hint: '2–3 letters, like DR' },
  colors: { pattern: /^[A-Z]{3}$/, hint: '3 letters, like BLK' },
  sizes: { pattern: /^[A-Z0-9]{1,5}$/, hint: 'up to 5 letters or digits, like M or 38' },
};

@Component({
  selector: 'app-lists',
  imports: [RouterLink],
  templateUrl: './lists.html',
  styleUrl: './lists.scss',
})
export class Lists {
  private readonly sb = inject(Supabase).client;
  private readonly catalogue = inject(Catalogue);

  protected readonly sizeTypes = Object.entries(SIZE_TYPE_LABEL) as [SizeType, string][];
  protected readonly rule = CODE_RULE;

  protected readonly categories = signal<Category[]>([]);
  protected readonly colours = signal<Colour[]>([]);
  protected readonly sizes = signal<Size[]>([]);
  protected readonly loaded = signal(false);
  protected readonly message = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);

  constructor() {
    this.reload().catch((e: Error) => this.message.set({ kind: 'error', text: e.message }));
  }

  protected async addCategory(event: Event): Promise<void> {
    const { form, data } = read(event);
    const ok = await this.insert('categories', { name: str(data, 'name'), size_type: str(data, 'type'), sort_order: nextOrder(this.categories()) }, str(data, 'code'));
    if (ok) form.reset();
  }

  protected async addColour(event: Event): Promise<void> {
    const { form, data } = read(event);
    const ok = await this.insert('colors', { name: str(data, 'name'), hex: str(data, 'hex'), sort_order: nextOrder(this.colours()) }, str(data, 'code'));
    if (ok) form.reset();
  }

  protected async addSize(event: Event): Promise<void> {
    const { form, data } = read(event);
    const ok = await this.insert('sizes', { label: str(data, 'name'), size_type: str(data, 'type'), sort_order: nextOrder(this.sizes()) }, str(data, 'code'));
    if (ok) form.reset();
  }

  protected async rename(kind: Kind, id: number, value: string): Promise<void> {
    const text = value.trim();
    if (!text) return this.reload();
    await this.update(kind, id, kind === 'sizes' ? { label: text } : { name: text });
  }

  protected async setHex(id: number, hex: string): Promise<void> {
    await this.update('colors', id, { hex });
  }

  protected async setActive(kind: Kind, id: number, active: boolean): Promise<void> {
    await this.update(kind, id, { active });
  }

  protected async remove(kind: Kind, id: number, label: string): Promise<void> {
    if (!confirm(`Delete “${label}”? If anything uses it, it will be kept and you can hide it instead.`)) return;
    this.message.set(null);
    const { error } = await this.sb.from(kind).delete().eq('id', id);
    if (error) {
      this.message.set({ kind: 'error', text: explain(error, 'Couldn’t delete that.') });
      return;
    }
    await this.reload();
  }

  protected typeLabel(t: SizeType): string {
    return SIZE_TYPE_LABEL[t];
  }

  private async insert(kind: Kind, row: Record<string, unknown>, code: string): Promise<boolean> {
    const clean = code.trim().toUpperCase();
    const name = String(row['name'] ?? row['label'] ?? '');
    if (!name.trim()) {
      this.message.set({ kind: 'error', text: 'Give it a name.' });
      return false;
    }
    if (!CODE_RULE[kind].pattern.test(clean)) {
      this.message.set({ kind: 'error', text: `The code needs to be ${CODE_RULE[kind].hint}.` });
      return false;
    }
    this.message.set(null);
    const { error } = await this.sb.from(kind).insert({ ...row, [kind === 'sizes' ? 'label' : 'name']: name.trim(), code: clean });
    if (error) {
      this.message.set({ kind: 'error', text: error.code === '23505' ? `The code ${clean} is already taken.` : explain(error, 'Couldn’t add that.') });
      return false;
    }
    this.message.set({ kind: 'ok', text: `Added ${name.trim()}.` });
    await this.reload();
    return true;
  }

  private async update(kind: Kind, id: number, patch: Record<string, unknown>): Promise<void> {
    this.message.set(null);
    const { error } = await this.sb.from(kind).update(patch).eq('id', id);
    if (error) this.message.set({ kind: 'error', text: explain(error, 'Couldn’t save that.') });
    await this.reload();
  }

  private async reload(): Promise<void> {
    const l = await this.catalogue.lookups();
    this.categories.set(l.categories);
    this.colours.set(l.colours);
    this.sizes.set(l.sizes);
    this.loaded.set(true);
  }
}

function read(event: Event): { form: HTMLFormElement; data: FormData } {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  return { form, data: new FormData(form) };
}

function str(data: FormData, key: string): string {
  return String(data.get(key) ?? '');
}

// New entries go to the end, with room left between them for reordering later.
function nextOrder(rows: { sort_order: number }[]): number {
  return Math.max(0, ...rows.map((r) => r.sort_order)) + 10;
}
