import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Catalogue, Category, Colour, ProductDetail, ProductInput, ProductStatus, Size, VariantRow } from '../../core/catalogue';
import { BarcodeLinker, LinkableSize, isLinked } from '../shared/barcode-linker';
import { ImageManager } from './image-manager';
import { VariantManager } from './variant-manager';

const blankToNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

@Component({
  selector: 'app-product-editor',
  imports: [ReactiveFormsModule, RouterLink, VariantManager, ImageManager, BarcodeLinker],
  templateUrl: './product-editor.html',
  styleUrl: './product-editor.scss',
})
export class ProductEditor {
  private readonly catalogue = inject(Catalogue);
  private readonly router = inject(Router);

  /** From the route (`products/:id`). Absent on `products/new`. */
  readonly id = input<string>();
  /** `?added=6`: just added this many items to stock, from the Add stock form. */
  readonly added = input<string>();
  /** `?photos=1`: photos that didn't upload there. */
  readonly photos = input<string>();

  protected readonly showLinker = signal(false);

  protected readonly isNew = computed(() => this.id() === undefined);
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly loadError = signal('');
  protected readonly saving = signal(false);
  protected readonly message = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);

  protected readonly categories = signal<Category[]>([]);
  protected readonly colours = signal<Colour[]>([]);
  protected readonly sizes = signal<Size[]>([]);
  protected readonly product = signal<ProductDetail | null>(null);
  protected readonly variants = signal<VariantRow[] | null>(null);

  /** Its sizes, for linking the barcodes on their tags. */
  protected readonly linkable = computed<LinkableSize[]>(() =>
    (this.variants() ?? []).map((v) => ({
      variantId: v.id,
      design: this.product()?.name ?? '',
      colour: v.color.name,
      size: v.size.label,
      sku: v.sku,
      barcode: v.barcode,
    })),
  );
  protected readonly unlinkedCount = computed(() => this.linkable().filter((s) => !isLinked(s)).length);

  /** Colours this design actually comes in, for tagging photos. */
  protected readonly usedColours = computed(() => {
    const seen = new Map<number, string>();
    for (const v of this.variants() ?? []) seen.set(v.color_id, v.color.name);
    return [...seen].map(([id, name]) => ({ id, name }));
  });

  protected readonly form = inject(FormBuilder).nonNullable.group({
    category_id: [0, Validators.min(1)],
    name: ['', [Validators.required, Validators.maxLength(120)]],
    description: [''],
    material: [''],
    brand: [''],
    status: ['draft' as ProductStatus],
    show_online: [false],
    featured: [false],
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.load(id));
    });
  }

  protected async save(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      this.message.set({ kind: 'error', text: this.isNew() && !this.form.controls.category_id.value ? 'Pick a category first.' : 'The name is needed.' });
      return;
    }
    this.saving.set(true);
    this.message.set(null);

    const { category_id, ...v } = this.form.getRawValue();
    const input: ProductInput = {
      name: v.name.trim(),
      description: blankToNull(v.description),
      material: blankToNull(v.material),
      brand: blankToNull(v.brand),
      status: v.status,
      show_online: v.show_online,
      featured: v.featured,
    };

    try {
      if (this.isNew()) {
        const newId = await this.catalogue.createProduct({ ...input, category_id });
        await this.router.navigate(['/admin/products', newId]);
      } else {
        await this.catalogue.updateProduct(this.product()!.id, input);
        this.product.update((p) => (p ? { ...p, ...input } : p));
        this.form.markAsPristine();
        this.message.set({ kind: 'ok', text: 'Saved.' });
      }
    } catch (e) {
      this.message.set({ kind: 'error', text: (e as Error).message });
    } finally {
      this.saving.set(false);
    }
  }

  /** The design's page in the shop, once it's for sale (as saved, not as being edited). */
  protected readonly shopLink = computed(() => {
    const p = this.product();
    return p && p.status === 'active' && p.show_online ? `${location.origin}/p/${p.slug}` : null;
  });
  protected readonly linkCopied = signal(false);

  // The DM workflow: a customer asks about a dress, she pastes its link, the
  // customer orders it themselves.
  protected async copyShopLink(): Promise<void> {
    const link = this.shopLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      this.linkCopied.set(true);
      setTimeout(() => this.linkCopied.set(false), 2000);
    } catch {
      window.open(link, '_blank', 'noopener');
    }
  }

  /** After a barcode is linked: the sizes again, with their new codes. */
  protected async reloadVariants(): Promise<void> {
    const p = this.product();
    if (p) this.variants.set(await this.catalogue.listVariants(p.id));
  }

  protected async remove(): Promise<void> {
    const p = this.product();
    if (!p || !confirm(`Delete “${p.name}” and its photos? This can’t be undone.`)) return;
    try {
      await this.catalogue.deleteProduct(p.id);
      await this.router.navigateByUrl('/admin/products');
    } catch (e) {
      this.message.set({ kind: 'error', text: (e as Error).message });
    }
  }

  private async load(id: string | undefined): Promise<void> {
    this.state.set('loading');
    this.message.set(null);
    try {
      const lookups = await this.catalogue.lookups();
      this.categories.set(lookups.categories);
      this.colours.set(lookups.colours);
      this.sizes.set(lookups.sizes);

      if (id === undefined) {
        this.product.set(null);
        this.variants.set(null);
        this.form.reset();
        this.state.set('ready');
        return;
      }

      const product = /^\d+$/.test(id) ? await this.catalogue.getProduct(Number(id)) : null;
      if (!product) {
        this.state.set('missing');
        return;
      }
      this.product.set(product);
      this.form.reset({
        category_id: product.category_id,
        name: product.name,
        description: product.description ?? '',
        material: product.material ?? '',
        brand: product.brand ?? '',
        status: product.status,
        show_online: product.show_online,
        featured: product.featured,
      });
      this.state.set('ready');
    } catch (e) {
      this.loadError.set((e as Error).message);
      this.state.set('error');
    }
  }
}
