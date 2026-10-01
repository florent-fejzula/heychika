import { Component, PendingTasks, inject, signal } from '@angular/core';
import { Supabase, supabaseConfigured } from '../../core/supabase';

interface ShopInfo {
  store_name: string;
  instagram_url: string | null;
  tiktok_url: string | null;
  facebook_url: string | null;
}

// Placeholder front door until the shop itself is built (phase 6). Rendered on
// the server, reading as the public (anon) role — so it also proves the shop's
// side of the access rules works.
@Component({
  selector: 'app-landing',
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
})
export class Landing {
  private readonly supabase = inject(Supabase).client;

  protected readonly info = signal<ShopInfo>({
    store_name: 'Hey Chika',
    instagram_url: null,
    tiktok_url: null,
    facebook_url: null,
  });

  constructor() {
    // The app is zoneless, so server rendering only waits for work it's told about.
    // Without this the page would be sent before the settings arrive.
    inject(PendingTasks).run(() => this.load());
  }

  private async load(): Promise<void> {
    if (!supabaseConfigured) return;
    const { data } = await this.supabase
      .from('settings')
      .select('store_name, instagram_url, tiktok_url, facebook_url')
      .maybeSingle<ShopInfo>();
    if (data) this.info.set(data);
  }
}
