import { Injectable, PLATFORM_ID, TransferState, inject, makeStateKey } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { Country, Currency, DeliveryZone } from '../core/money';
import { thumbPath } from '../core/images';
import { Supabase } from '../core/supabase';

export interface ShopSettings {
  store_name: string;
  contact_phone: string | null;
  contact_email: string | null;
  instagram_url: string | null;
  tiktok_url: string | null;
  facebook_url: string | null;
  mkd_per_eur: number;
  all_per_eur: number;
  mkd_rounding: number;
  all_rounding: number;
}

export interface ShopCategory {
  id: number;
  name: string;
  slug: string;
}

/** The words on the About and Delivery & returns pages, as the owners wrote them in Settings. */
export interface ShopPages {
  about_text: string;
  returns_text: string;
}

export interface ShopContext {
  settings: ShopSettings;
  zones: DeliveryZone[];
  categories: ShopCategory[];
}

export interface ShopColour {
  id: number;
  name: string;
  hex: string | null;
  sort_order: number;
}

export interface ShopVariant {
  id: number;
  price_eur: number;
  compare_at_price_eur: number | null;
  color: ShopColour;
  size: { id: number; label: string; sort_order: number };
  available: number;
}

export interface ShopImage {
  storage_path: string;
  color_id: number | null;
  is_primary: boolean;
  sort_order: number;
}

export interface ShopProduct {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  material: string | null;
  featured: boolean;
  created_at: string;
  category: { id: number; name: string; sort_order: number };
  /** Active sizes only, ordered by colour then size. */
  variants: ShopVariant[];
  /** Cover first, then in the order she arranged them. */
  images: ShopImage[];
}

/** One line of the bag, as it stands now in the shop. */
export interface BagItem {
  variantId: number;
  priceEur: number;
  available: number;
  product: { slug: string; name: string };
  color: { name: string; hex: string | null };
  size: string;
  image: string | null;
}

export interface CustomerDetails {
  first_name: string;
  last_name: string;
  phone: string;
  city: string;
  address: string;
  postal_code: string;
}

export interface PlacedOrder {
  order_number: string;
  currency: Currency;
  total_in_currency: number;
}

export type OrderStatus =
  | 'new' | 'confirmed' | 'dispatched' | 'delivered' | 'completed'
  | 'cancelled' | 'delivery_failed' | 'returned' | 'partially_returned';

export interface TrackedOrder {
  order_number: string;
  status: OrderStatus;
  created_at: string;
  dispatched_at: string | null;
  delivered_at: string | null;
  country: Country;
  currency: Currency;
  city: string;
  first_name: string;
  delivery_fee: number;
  total: number;
  lines: { name: string; color: string; size: string; qty: number; price: number }[];
}

/** Why checkout refused an order, in a form the checkout page can act on. */
export type CheckoutProblem =
  | { kind: 'sold_out'; variantId: number; available: number }
  | { kind: 'not_available'; variantId: number }
  | { kind: 'price_changed'; total: number }
  | { kind: 'too_many_orders' }
  | { kind: 'busy' }
  | { kind: 'invalid'; field: string }
  | { kind: 'offline' }
  | { kind: 'unknown' };

export class CheckoutError extends Error {
  constructor(readonly problem: CheckoutProblem) {
    super(problem.kind);
  }
}

const BUCKET = 'product-images';

const PRODUCT_SELECT =
  'id, slug, name, description, material, featured, created_at, status, show_online,' +
  'category:categories(id, name, sort_order),' +
  'variants(id, price_eur, compare_at_price_eur, active, color:colors(id, name, hex, sort_order), size:sizes(id, label, sort_order), stock(qty_available)),' +
  'images:product_images(storage_path, color_id, is_primary, sort_order)';

interface RawVariant {
  id: number;
  price_eur: number;
  compare_at_price_eur: number | null;
  active: boolean;
  color: ShopColour;
  size: { id: number; label: string; sort_order: number };
  stock: { qty_available: number } | { qty_available: number }[] | null;
}

interface RawProduct extends Omit<ShopProduct, 'variants'> {
  status: string;
  show_online: boolean;
  variants: RawVariant[];
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function available(stock: RawVariant['stock']): number {
  const row = Array.isArray(stock) ? stock[0] : stock;
  return Math.max(0, row?.qty_available ?? 0);
}

// The shop reads as the public role, which only sees what's for sale. But when
// one of the owners is signed in, the same requests run as staff and see drafts
// too, so the shop filters for itself rather than rely on who's asking.
function forSale(p: { status: string; show_online: boolean }): boolean {
  return p.status === 'active' && p.show_online;
}

function shape(p: RawProduct): ShopProduct {
  const { status: _s, show_online: _o, ...rest } = p;
  return {
    ...rest,
    variants: p.variants
      .filter((v) => v.active)
      .map((v) => ({
        id: v.id,
        price_eur: Number(v.price_eur),
        compare_at_price_eur: v.compare_at_price_eur === null ? null : Number(v.compare_at_price_eur),
        color: v.color,
        size: v.size,
        available: available(v.stock),
      }))
      .sort((a, b) => a.color.sort_order - b.color.sort_order || a.color.name.localeCompare(b.color.name) || a.size.sort_order - b.size.sort_order),
    images: [...p.images].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order),
  };
}

@Injectable({ providedIn: 'root' })
export class ShopApi {
  private readonly sb = inject(Supabase).client;
  private readonly state = inject(TransferState);
  private readonly server = isPlatformServer(inject(PLATFORM_ID));

  imageUrl(path: string, thumb = false): string {
    return this.sb.storage.from(BUCKET).getPublicUrl(thumb ? thumbPath(path) : path).data.publicUrl;
  }

  // --------------------------------------------------------------- reading

  context(): Promise<ShopContext> {
    return this.once('shop-context', async () => {
      const [settings, zones, categories] = await Promise.all([
        this.sb
          .from('settings')
          .select('store_name, contact_phone, contact_email, instagram_url, tiktok_url, facebook_url, mkd_per_eur, all_per_eur, mkd_rounding, all_rounding')
          .single<ShopSettings>(),
        this.sb.from('delivery_zones').select('country, currency, fee_eur, free_over_eur, est_days, active').eq('active', true),
        this.sb.from('categories').select('id, name, sort_order').eq('active', true).order('sort_order'),
      ]);
      if (settings.error || zones.error || categories.error) throw settings.error ?? zones.error ?? categories.error;

      const s = settings.data;
      return {
        settings: {
          ...s,
          mkd_per_eur: Number(s.mkd_per_eur),
          all_per_eur: Number(s.all_per_eur),
          mkd_rounding: Number(s.mkd_rounding),
          all_rounding: Number(s.all_rounding),
        },
        zones: (zones.data ?? []).map((z) => ({
          country: z.country,
          currency: z.currency,
          fee_eur: Number(z.fee_eur),
          free_over_eur: z.free_over_eur === null ? null : Number(z.free_over_eur),
          est_days: z.est_days,
        })),
        categories: (categories.data ?? []).map((c) => ({ id: c.id, name: c.name, slug: slugify(c.name) })),
      };
    });
  }

  pages(): Promise<ShopPages> {
    return this.once('shop-pages', async () => {
      const { data, error } = await this.sb.from('settings').select('about_text, returns_text').single<ShopPages>();
      if (error) throw error;
      return data;
    });
  }

  products(): Promise<ShopProduct[]> {
    return this.once('shop-products', async () => {
      const { data, error } = await this.sb
        .from('products')
        .select(PRODUCT_SELECT)
        .eq('status', 'active')
        .eq('show_online', true)
        .order('created_at', { ascending: false })
        .overrideTypes<RawProduct[], { merge: false }>();
      if (error) throw error;
      return data.filter(forSale).map(shape).filter((p) => p.variants.length > 0);
    });
  }

  /** null when there's no such product, or it's no longer for sale. */
  product(slug: string): Promise<ShopProduct | null> {
    return this.once(`shop-product:${slug}`, async () => {
      const { data, error } = await this.sb
        .from('products')
        .select(PRODUCT_SELECT)
        .eq('slug', slug)
        .maybeSingle()
        .overrideTypes<RawProduct, { merge: false }>();
      if (error) throw error;
      if (!data || !forSale(data)) return null;
      const p = shape(data);
      return p.variants.length ? p : null;
    });
  }

  /** The bag's items as they stand now. Anything no longer for sale is left out. */
  async bagItems(variantIds: number[]): Promise<BagItem[]> {
    if (!variantIds.length) return [];
    const { data, error } = await this.sb
      .from('variants')
      .select(
        'id, price_eur, active, color:colors(id, name, hex), size:sizes(label), stock(qty_available),' +
          'product:products(slug, name, status, show_online, images:product_images(storage_path, color_id, is_primary, sort_order))',
      )
      .in('id', variantIds)
      .overrideTypes<
        {
          id: number;
          price_eur: number;
          active: boolean;
          color: { id: number; name: string; hex: string | null };
          size: { label: string };
          stock: RawVariant['stock'];
          product: { slug: string; name: string; status: string; show_online: boolean; images: ShopImage[] };
        }[],
        { merge: false }
      >();
    if (error) throw error;

    return data
      .filter((v) => v.active && forSale(v.product))
      .map((v) => {
        const image = pickImage(v.product.images, v.color.id);
        return {
          variantId: v.id,
          priceEur: Number(v.price_eur),
          available: available(v.stock),
          product: { slug: v.product.slug, name: v.product.name },
          color: { name: v.color.name, hex: v.color.hex },
          size: v.size.label,
          image: image ? this.imageUrl(image.storage_path, true) : null,
        };
      });
  }

  async trackOrder(orderNumber: string, phone: string): Promise<TrackedOrder | null> {
    const { data, error } = await this.sb.rpc('track_order', { p_order_number: orderNumber, p_phone: phone });
    if (error) throw error;
    const o = data as TrackedOrder | null;
    if (!o) return null;
    return {
      ...o,
      delivery_fee: Number(o.delivery_fee),
      total: Number(o.total),
      lines: o.lines.map((l) => ({ ...l, price: Number(l.price) })),
    };
  }

  // --------------------------------------------------------------- ordering

  async placeOrder(
    country: Country,
    customer: CustomerDetails,
    lines: { variant_id: number; qty: number }[],
    notes: string,
    expectedTotal: number,
  ): Promise<PlacedOrder> {
    let result;
    try {
      result = await this.sb.rpc('place_order', {
        p_country: country,
        p_customer: customer,
        p_lines: lines,
        p_notes: notes || null,
        p_expected_total: expectedTotal,
      });
    } catch {
      throw new CheckoutError({ kind: 'offline' });
    }
    if (result.error) throw new CheckoutError(problemOf(result.error));
    const placed = result.data as PlacedOrder;
    return { ...placed, total_in_currency: Number(placed.total_in_currency) };
  }

  // --------------------------------------------------------------- plumbing

  // The server loads a page's data to render it, then hands it to the browser
  // inside the page, so the browser doesn't ask the database again on arrival.
  // Used once: later visits in the same session load fresh.
  private async once<T>(key: string, load: () => Promise<T>): Promise<T> {
    const k = makeStateKey<T>(key);
    if (!this.server && this.state.hasKey(k)) {
      const value = this.state.get(k, null) as T;
      this.state.remove(k);
      return value;
    }
    const value = await load();
    if (this.server) this.state.set(k, value);
    return value;
  }
}

/** A photo of this colour if there is one, else the cover. */
export function pickImage(images: ShopImage[], colorId: number | null): ShopImage | null {
  const sorted = [...images].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order);
  return sorted.find((i) => i.color_id === colorId) ?? sorted.find((i) => i.color_id === null) ?? sorted[0] ?? null;
}

export function problemOf(error: { message?: string; details?: string | null; hint?: string | null }): CheckoutProblem {
  const message = error.message ?? '';
  const detail = error.details ?? '';
  if (/insufficient_stock/.test(message)) return { kind: 'sold_out', variantId: Number(detail), available: Number(error.hint ?? 0) };
  if (/not_available/.test(message)) return { kind: 'not_available', variantId: Number(detail) };
  if (/price_changed/.test(message)) return { kind: 'price_changed', total: Number(detail) };
  if (/too_many_orders/.test(message)) return { kind: 'too_many_orders' };
  if (/shop_busy/.test(message)) return { kind: 'busy' };
  if (/invalid_order/.test(message)) return { kind: 'invalid', field: detail };
  if (/failed to fetch|networkerror|load failed/i.test(message)) return { kind: 'offline' };
  return { kind: 'unknown' };
}
