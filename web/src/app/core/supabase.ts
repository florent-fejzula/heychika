import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

export const supabaseConfigured = !environment.supabaseUrl.includes('YOUR-PROJECT');

// A shop page waits for its data before it is sent. If the database is slow,
// send the page without that data rather than leave a customer staring at nothing.
//
// Retries must be off for this to hold: the client retries failed reads with
// backoff, and it treats a timeout as a retryable failure, so a 3s timeout with
// retries on took 19s to give up.
const SERVER_DB_TIMEOUT_MS = 3000;

/**
 * Every row of a query, however many there are. The database hands back at most
 * 1000 rows per request (Supabase's default), and quietly stops there, so a report
 * over a year of orders would otherwise just be missing the rest. The query must
 * have a stable order (by id) for the pages to line up.
 */
export async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  size = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  // Ask until a page comes back empty, rather than stopping at a short page: if the
  // server's own cap is lower than `size`, every page is "short".
  for (;;) {
    const { data, error } = await page(rows.length, rows.length + size - 1);
    if (error) throw error;
    if (!data?.length) return rows;
    rows.push(...data);
  }
}

@Injectable({ providedIn: 'root' })
export class Supabase {
  readonly client: SupabaseClient;

  constructor() {
    // On the server there is no browser storage and no logged-in user:
    // server rendering is only for the public shop, which reads as anon.
    const browser = isPlatformBrowser(inject(PLATFORM_ID));
    this.client = createClient(environment.supabaseUrl, environment.supabaseKey, {
      auth: { persistSession: browser, autoRefreshToken: browser, detectSessionInUrl: browser },
      db: browser ? {} : { timeout: SERVER_DB_TIMEOUT_MS, retry: false },
    });
  }
}
