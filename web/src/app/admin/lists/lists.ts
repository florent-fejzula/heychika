import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Catalogue, Category, Colour, Size, SizeType } from '../../core/catalogue';
import { explain } from '../../core/errors';
import { I18n, TranslatePipe } from '../../core/i18n';
import { Supabase } from '../../core/supabase';

type Kind = 'categories' | 'colors' | 'sizes';

const SIZE_TYPES: SizeType[] = ['letter', 'numeric', 'one_size'];

// Codes become part of every SKU, so they follow the same rules the database enforces
// (and the database refuses to change one once something uses it). The rule in
// words is admin.lists.hint.<kind> in src/i18n.
const CODE_RULE: Record<Kind, RegExp> = {
  categories: /^[A-Z]{2,3}$/,
  colors: /^[A-Z]{3}$/,
  sizes: /^[A-Z0-9]{1,5}$/,
};

@Component({
  selector: 'app-lists',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './lists.html',
  styleUrl: './lists.scss',
})
export class Lists {
  private readonly sb = inject(Supabase).client;
  private readonly catalogue = inject(Catalogue);
  private readonly i18n = inject(I18n);

  protected readonly sizeTypes = SIZE_TYPES;

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
    const ok = await this.insert('categories', { name: str(data, 'name'), name_sq: opt(data, 'name_sq'), size_type: str(data, 'type'), sort_order: nextOrder(this.categories()) }, str(data, 'code'));
    if (ok) form.reset();
  }

  protected async addColour(event: Event): Promise<void> {
    const { form, data } = read(event);
    const ok = await this.insert('colors', { name: str(data, 'name'), name_sq: opt(data, 'name_sq'), hex: str(data, 'hex'), sort_order: nextOrder(this.colours()) }, str(data, 'code'));
    if (ok) form.reset();
  }

  protected async addSize(event: Event): Promise<void> {
    const { form, data } = read(event);
    const ok = await this.insert('sizes', { label: str(data, 'name'), label_sq: opt(data, 'name_sq'), size_type: str(data, 'type'), sort_order: nextOrder(this.sizes()) }, str(data, 'code'));
    if (ok) form.reset();
  }

  protected async rename(kind: Kind, id: number, value: string): Promise<void> {
    const text = value.trim();
    if (!text) return this.reload();
    await this.update(kind, id, kind === 'sizes' ? { label: text } : { name: text });
  }

  /** The Albanian name the shop shows. Cleared, the shop shows the English one. */
  protected async renameSq(kind: Kind, id: number, value: string): Promise<void> {
    const text = value.trim() || null;
    await this.update(kind, id, kind === 'sizes' ? { label_sq: text } : { name_sq: text });
  }

  protected async setHex(id: number, hex: string): Promise<void> {
    await this.update('colors', id, { hex });
  }

  protected async setActive(kind: Kind, id: number, active: boolean): Promise<void> {
    await this.update(kind, id, { active });
  }

  protected async remove(kind: Kind, id: number, label: string): Promise<void> {
    if (!confirm(this.i18n.t('admin.lists.confirmDelete', { name: label }))) return;
    this.message.set(null);
    const { error } = await this.sb.from(kind).delete().eq('id', id);
    if (error) {
      this.message.set({ kind: 'error', text: explain(error, 'errors.delete') });
      return;
    }
    await this.reload();
  }

  private async insert(kind: Kind, row: Record<string, unknown>, code: string): Promise<boolean> {
    const clean = code.trim().toUpperCase();
    const name = String(row['name'] ?? row['label'] ?? '');
    if (!name.trim()) {
      this.message.set({ kind: 'error', text: this.i18n.t('admin.lists.nameIt') });
      return false;
    }
    if (!CODE_RULE[kind].test(clean)) {
      this.message.set({ kind: 'error', text: this.i18n.t('admin.lists.badCode.' + kind) });
      return false;
    }
    this.message.set(null);
    const { error } = await this.sb.from(kind).insert({ ...row, [kind === 'sizes' ? 'label' : 'name']: name.trim(), code: clean });
    if (error) {
      this.message.set({ kind: 'error', text: error.code === '23505' ? this.i18n.t('admin.lists.codeTaken', { code: clean }) : explain(error, 'errors.add') });
      return false;
    }
    this.message.set({ kind: 'ok', text: this.i18n.t('admin.lists.added', { name: name.trim() }) });
    await this.reload();
    return true;
  }

  private async update(kind: Kind, id: number, patch: Record<string, unknown>): Promise<void> {
    this.message.set(null);
    const { error } = await this.sb.from(kind).update(patch).eq('id', id);
    if (error) this.message.set({ kind: 'error', text: explain(error, 'errors.saveThat') });
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

// Left out of the insert when empty (undefined isn't sent), so adding works the
// same on a database without the Albanian names.
function opt(data: FormData, key: string): string | undefined {
  return str(data, key).trim() || undefined;
}

// New entries go to the end, with room left between them for reordering later.
function nextOrder(rows: { sort_order: number }[]): number {
  return Math.max(0, ...rows.map((r) => r.sort_order)) + 10;
}
