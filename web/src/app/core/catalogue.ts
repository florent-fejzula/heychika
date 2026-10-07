import { Injectable, inject } from '@angular/core';
import { explain } from './errors';
import { prepareImage, thumbPath } from './images';
import { Supabase, allRows } from './supabase';

export type SizeType = 'letter' | 'numeric' | 'one_size';
export type ProductStatus = 'draft' | 'active' | 'archived';

export interface Category {
  id: number;
  code: string;
  name: string;
  /** Its name in the shop when read in Albanian; empty means the same as `name`. */
  name_sq?: string | null;
  size_type: SizeType;
  sort_order: number;
  active: boolean;
}

export interface Colour {
  id: number;
  code: string;
  name: string;
  name_sq?: string | null;
  hex: string | null;
  sort_order: number;
  active: boolean;
}

export interface Size {
  id: number;
  code: string;
  label: string;
  label_sq?: string | null;
  size_type: SizeType;
  sort_order: number;
  active: boolean;
}

export interface StockLevels {
  qty_physical: number;
  qty_reserved: number;
  qty_available: number;
  qty_in_transit: number;
  qty_damaged: number;
}

export interface ProductSummary {
  id: number;
  name: string;
  model_code: string;
  status: ProductStatus;
  show_online: boolean;
  featured: boolean;
  category: { code: string; name: string };
  variants: { id: number; price_eur: number; active: boolean; stock: Pick<StockLevels, 'qty_physical' | 'qty_available'> | null }[];
  images: { storage_path: string; is_primary: boolean; sort_order: number }[];
}

export interface ProductDetail {
  id: number;
  category_id: number;
  model_code: string;
  name: string;
  slug: string;
  description: string | null;
  material: string | null;
  brand: string | null;
  status: ProductStatus;
  show_online: boolean;
  featured: boolean;
  category: { code: string; name: string; size_type: SizeType };
}

export interface ProductInput {
  category_id?: number;
  name: string;
  description: string | null;
  material: string | null;
  brand: string | null;
  status: ProductStatus;
  show_online: boolean;
  featured: boolean;
}

export interface VariantRow {
  id: number;
  product_id: number;
  color_id: number;
  size_id: number;
  sku: string;
  barcode: string;
  price_eur: number;
  cost_eur: number;
  locked: boolean;
  active: boolean;
  color: { code: string; name: string; hex: string | null };
  size: { code: string; label: string; sort_order: number };
  stock: StockLevels | null;
}

export interface ImageRow {
  id: number;
  product_id: number;
  color_id: number | null;
  storage_path: string;
  sort_order: number;
  is_primary: boolean;
}

export interface LabelVariant {
  id: number;
  sku: string;
  barcode: string;
  price_eur: number;
  active: boolean;
  product: { id: number; name: string; status: ProductStatus };
  color: { name: string };
  size: { label: string; sort_order: number };
  stock: { qty_physical: number } | null;
}

export interface ScanResult {
  id: number;
  sku: string;
  barcode: string;
  price_eur: number;
  active: boolean;
  product: { id: number; name: string; model_code: string; status: ProductStatus };
  color: { name: string; hex: string | null };
  size: { label: string };
  stock: StockLevels | null;
}

const BUCKET = 'product-images';

// A one-to-one embed comes back as an object, but be forgiving if it's ever an array.
function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function fail(error: unknown, fallback?: string): never {
  throw new Error(explain(error, fallback));
}

@Injectable({ providedIn: 'root' })
export class Catalogue {
  private readonly sb = inject(Supabase).client;

  // ---------------------------------------------------------------- lookups

  async lookups(): Promise<{ categories: Category[]; colours: Colour[]; sizes: Size[] }> {
    const [c, col, s] = await Promise.all([
      this.sb.from('categories').select('*').order('sort_order').order('name').overrideTypes<Category[], { merge: false }>(),
      this.sb.from('colors').select('*').order('sort_order').order('name').overrideTypes<Colour[], { merge: false }>(),
      this.sb.from('sizes').select('*').order('sort_order').overrideTypes<Size[], { merge: false }>(),
    ]);
    if (c.error || col.error || s.error) fail(c.error ?? col.error ?? s.error);
    return { categories: c.data, colours: col.data, sizes: s.data };
  }

  // --------------------------------------------------------------- products

  async listProducts(): Promise<ProductSummary[]> {
    const { data, error } = await this.sb
      .from('products')
      .select(
        'id, name, model_code, status, show_online, featured, category:categories(code, name),' +
          'variants(id, price_eur, active, stock(qty_physical, qty_available)),' +
          'images:product_images(storage_path, is_primary, sort_order)',
      )
      .order('created_at', { ascending: false })
      .overrideTypes<ProductSummary[], { merge: false }>();
    if (error) fail(error, 'errors.loadProducts');
    return data.map((p) => ({ ...p, variants: p.variants.map((v) => ({ ...v, stock: first(v.stock) })) }));
  }

  async getProduct(id: number): Promise<ProductDetail | null> {
    const { data, error } = await this.sb
      .from('products')
      .select('id, category_id, model_code, name, slug, description, material, brand, status, show_online, featured, category:categories(code, name, size_type)')
      .eq('id', id)
      .maybeSingle()
      .overrideTypes<ProductDetail, { merge: false }>();
    if (error) fail(error, 'errors.loadDesign');
    return data;
  }

  async createProduct(input: ProductInput & { category_id: number }): Promise<number> {
    const { data, error } = await this.sb.from('products').insert(input).select('id').single<{ id: number }>();
    if (error) fail(error, 'errors.createDesign');
    return data.id;
  }

  async updateProduct(id: number, input: Omit<ProductInput, 'category_id'>): Promise<void> {
    const { error } = await this.sb.from('products').update(input).eq('id', id);
    if (error) fail(error, 'errors.saveDesign');
  }

  /** Only works while the design has no sizes. Removes its photos from storage too. */
  async deleteProduct(id: number): Promise<void> {
    const images = await this.listImages(id);
    const { error } = await this.sb.from('products').delete().eq('id', id);
    if (error) fail(error, 'errors.deleteDesign');
    await this.removeFiles(images.map((i) => i.storage_path));
  }

  /**
   * Brands already used, most used first, so the brand box can offer them. Spelled
   * the way they were written most often ("Vavex" and "vavex" are one brand).
   */
  async brands(): Promise<string[]> {
    const { data, error } = await this.sb.from('products').select('brand').not('brand', 'is', null).overrideTypes<{ brand: string }[], { merge: false }>();
    if (error) return [];
    return rankBrands(data.map((r) => r.brand));
  }

  // --------------------------------------------------------------- variants

  async listVariants(productId: number): Promise<VariantRow[]> {
    const { data, error } = await this.sb
      .from('variants')
      .select(
        'id, product_id, color_id, size_id, sku, barcode, price_eur, cost_eur, locked, active,' +
          'color:colors(code, name, hex), size:sizes(code, label, sort_order),' +
          'stock(qty_physical, qty_reserved, qty_available, qty_in_transit, qty_damaged)',
      )
      .eq('product_id', productId)
      .overrideTypes<VariantRow[], { merge: false }>();
    if (error) fail(error, 'errors.loadSizes');
    return data
      .map((v) => ({ ...v, stock: first(v.stock) }))
      .sort((a, b) => a.color.name.localeCompare(b.color.name) || a.size.sort_order - b.size.sort_order);
  }

  async addVariants(productId: number, combos: { color_id: number; size_id: number }[], priceEur: number): Promise<void> {
    if (!combos.length) return;
    const rows = combos.map((c) => ({ product_id: productId, ...c, price_eur: priceEur }));
    const { error } = await this.sb.from('variants').insert(rows);
    if (error) fail(error, 'errors.addSizes');
  }

  /** One request: every size of the design gets this price. */
  async setAllPrices(productId: number, priceEur: number): Promise<void> {
    const { error } = await this.sb.from('variants').update({ price_eur: priceEur }).eq('product_id', productId);
    if (error) fail(error, 'errors.savePrices');
  }

  async updateVariant(id: number, patch: { price_eur?: number; active?: boolean }): Promise<void> {
    const { error } = await this.sb.from('variants').update(patch).eq('id', id);
    if (error) fail(error, 'errors.save');
  }

  async deleteVariant(id: number): Promise<void> {
    const { error } = await this.sb.from('variants').delete().eq('id', id);
    if (error) fail(error, 'errors.removeSize');
  }

  // ----------------------------------------------------------------- photos

  imageUrl(path: string, thumb = false): string {
    return this.sb.storage.from(BUCKET).getPublicUrl(thumb ? thumbPath(path) : path).data.publicUrl;
  }

  async listImages(productId: number): Promise<ImageRow[]> {
    const { data, error } = await this.sb
      .from('product_images')
      .select('*')
      .eq('product_id', productId)
      .order('sort_order')
      .order('id')
      .overrideTypes<ImageRow[], { merge: false }>();
    if (error) fail(error, 'errors.loadPhotos');
    return data;
  }

  async uploadImage(productId: number, file: File, sortOrder: number): Promise<void> {
    let prepared;
    try {
      prepared = await prepareImage(file);
    } catch {
      throw new Error(`“${file.name}” isn’t a photo this browser can read.`);
    }

    const path = `${productId}/${crypto.randomUUID()}.jpg`;
    const bucket = this.sb.storage.from(BUCKET);
    const options = { contentType: 'image/jpeg', cacheControl: '31536000' }; // names are unique, so cache forever

    const full = await bucket.upload(path, prepared.full, options);
    if (full.error) fail(full.error, 'errors.uploadPhoto');
    const thumb = await bucket.upload(thumbPath(path), prepared.thumb, options);
    if (thumb.error) {
      await this.removeFiles([path]);
      fail(thumb.error, 'errors.uploadPhoto');
    }

    const { error } = await this.sb
      .from('product_images')
      .insert({ product_id: productId, storage_path: path, sort_order: sortOrder });
    if (error) {
      await this.removeFiles([path]);
      fail(error, 'errors.savePhoto');
    }
  }

  async setCover(imageId: number): Promise<void> {
    const { error } = await this.sb.rpc('set_primary_image', { p_image_id: imageId });
    if (error) fail(error, 'errors.changeCover');
  }

  async reorderImages(productId: number, ids: number[]): Promise<void> {
    const { error } = await this.sb.rpc('reorder_images', { p_product_id: productId, p_ids: ids });
    if (error) fail(error, 'errors.reorderPhotos');
  }

  async setImageColour(imageId: number, colourId: number | null): Promise<void> {
    const { error } = await this.sb.from('product_images').update({ color_id: colourId }).eq('id', imageId);
    if (error) fail(error, 'errors.save');
  }

  async deleteImage(image: ImageRow): Promise<void> {
    const { error } = await this.sb.from('product_images').delete().eq('id', image.id);
    if (error) fail(error, 'errors.deletePhoto');
    await this.removeFiles([image.storage_path]);
  }

  // Storage cleanup is best effort: an orphaned file costs nothing and breaks nothing.
  private async removeFiles(paths: string[]): Promise<void> {
    if (!paths.length) return;
    await this.sb.storage.from(BUCKET).remove(paths.flatMap((p) => [p, thumbPath(p)])).catch(() => undefined);
  }

  // ------------------------------------------------------- labels and scans

  async labelVariants(): Promise<LabelVariant[]> {
    const data = await allRows<LabelVariant>((from, to) =>
      this.sb
        .from('variants')
        .select(
          'id, sku, barcode, price_eur, active, product:products(id, name, status), color:colors(name),' +
            'size:sizes(label, sort_order), stock(qty_physical)',
        )
        .order('id')
        .range(from, to)
        .overrideTypes<LabelVariant[], { merge: false }>(),
    ).catch((e) => fail(e, 'errors.loadProducts'));
    return data.map((v) => ({ ...v, stock: first(v.stock) }));
  }

  /** Finds a variant by what's printed on its sticker (the barcode), or by SKU typed by hand. */
  async findVariant(code: string): Promise<ScanResult | null> {
    const select =
      'id, sku, barcode, price_eur, active, product:products(id, name, model_code, status), color:colors(name, hex),' +
      'size:sizes(label), stock(qty_physical, qty_reserved, qty_available, qty_in_transit, qty_damaged)';

    for (const column of ['barcode', 'sku'] as const) {
      const { data, error } = await this.sb
        .from('variants')
        .select(select)
        .eq(column, code)
        .maybeSingle()
        .overrideTypes<ScanResult, { merge: false }>();
      if (error) fail(error, 'errors.lookUp');
      if (data) return { ...data, stock: first(data.stock) };
    }
    return null;
  }
}

const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Distinct brands, most used first; each in the spelling used most often. */
export function rankBrands(names: string[]): string[] {
  const groups = new Map<string, Map<string, number>>();
  for (const raw of names) {
    const name = tidy(raw);
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    const spellings = groups.get(key) ?? new Map<string, number>();
    spellings.set(name, (spellings.get(name) ?? 0) + 1);
    groups.set(key, spellings);
  }
  return [...groups.values()]
    .map((spellings) => {
      const [best] = [...spellings].sort((a, b) => b[1] - a[1]);
      return { name: best[0], uses: [...spellings.values()].reduce((a, b) => a + b, 0) };
    })
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name))
    .map((b) => b.name);
}

/** A brand as typed, in the spelling already in use if it matches one ("vavex" → "Vavex"). */
export function sameBrand(typed: string, known: string[]): string | null {
  const name = tidy(typed);
  if (!name) return null;
  return known.find((k) => k.toLocaleLowerCase() === name.toLocaleLowerCase()) ?? name;
}
