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
