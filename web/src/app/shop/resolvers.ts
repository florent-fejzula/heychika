import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { supabaseConfigured } from '../core/supabase';
import { ShopApi, ShopProduct } from './shop-api';
import { ShopState } from './shop-state';

/** What a page got: its data, or a note that the database couldn't be reached. */
export type Loaded<T> = { ok: true; value: T } | { ok: false };

// Resolvers rather than loading in the component: the router waits for them,
// so a page rendered on the server always has its data in it.
//
// inject() only works before the first await, so every resolver takes what it
// needs up front.

export const shopContextResolver: ResolveFn<boolean> = async () => {
  const state = inject(ShopState);
  const api = inject(ShopApi);
  if (state.context() || !supabaseConfigured) return true;
  try {
    state.context.set(await api.context());
  } catch {
    // Pages still render, with default rates and no delivery zones; checkout says it can't take orders.
  }
  return true;
};

export const productsResolver: ResolveFn<Loaded<ShopProduct[]>> = async () => {
  const api = inject(ShopApi);
  if (!supabaseConfigured) return { ok: true, value: [] };
  try {
    return { ok: true, value: await api.products() };
  } catch {
    return { ok: false };
  }
};

export const productResolver: ResolveFn<Loaded<ShopProduct | null>> = async (route) => {
  const api = inject(ShopApi);
  if (!supabaseConfigured) return { ok: true, value: null };
  try {
    return { ok: true, value: await api.product(route.paramMap.get('slug') ?? '') };
  } catch {
    return { ok: false };
  }
};
