import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { COUNTRY_NAME, Country, Currency, formatMoney, localPrice } from '../../core/money';
import { Supabase } from '../../core/supabase';

interface SettingsRow {
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
  default_markup_pct: number;
  fx_updated_at: string;
}

interface ZoneRow {
  country: Country;
  currency: Currency;
  fee_eur: number;
  free_over_eur: number | null;
  est_days: string | null;
  active: boolean;
}

// The lek floats; a rate older than this gets a nudge to check it.
const STALE_FX_DAYS = 30;
const URL_PATTERN = /^https:\/\/\S+$/;

@Component({
  selector: 'app-settings',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  private readonly supabase = inject(Supabase).client;
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly countryName = COUNTRY_NAME;
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly saving = signal(false);
  protected readonly message = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);
  protected readonly fxAgeDays = signal(0);

  protected readonly form = this.fb.group({
    mkd_per_eur: [61.5, [Validators.required, Validators.min(0.000001)]],
    all_per_eur: [98, [Validators.required, Validators.min(0.000001)]],
    mkd_rounding: [50, [Validators.required, Validators.min(0.01)]],
    all_rounding: [100, [Validators.required, Validators.min(0.01)]],
    default_markup_pct: [50, [Validators.required, Validators.min(0)]],
    store_name: ['Hey Chika', Validators.required],
    contact_phone: [''],
    contact_email: ['', Validators.email],
    instagram_url: ['', Validators.pattern(URL_PATTERN)],
    tiktok_url: ['', Validators.pattern(URL_PATTERN)],
    facebook_url: ['', Validators.pattern(URL_PATTERN)],
    zones: this.fb.array<ZoneGroup>([]),
  });

  // Live preview of what a customer in each country would see.
  protected readonly samplePrice = signal(25);
  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly preview = computed(() => {
    const v = this.values();
    const fx = {
      mkd_per_eur: Number(v.mkd_per_eur),
      all_per_eur: Number(v.all_per_eur),
      mkd_rounding: Number(v.mkd_rounding),
      all_rounding: Number(v.all_rounding),
    };
    if (Object.values(fx).some((n) => !(n > 0))) return null;
    const eur = this.samplePrice();
    return (['EUR', 'MKD', 'ALL'] as const).map((c) => formatMoney(localPrice(eur, c, fx), c));
  });

  constructor() {
    this.load().catch(() => this.state.set('error'));
  }

  protected get zones(): FormArray<ZoneGroup> {
    return this.form.controls.zones;
  }

  protected setSample(value: string): void {
    const n = Number(value);
    this.samplePrice.set(Number.isFinite(n) && n >= 0 ? n : 0);
  }

  protected async save(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      this.message.set({ kind: 'error', text: 'Some fields need fixing — they’re marked in red.' });
      return;
    }
    this.saving.set(true);
    this.message.set(null);

    const { zones, ...settings } = this.form.getRawValue();
    const blankToNull = (s: string) => (s.trim() === '' ? null : s.trim());

    const [s, z] = await Promise.all([
      this.supabase
        .from('settings')
        .update({
          ...settings,
          contact_phone: blankToNull(settings.contact_phone),
          contact_email: blankToNull(settings.contact_email),
          instagram_url: blankToNull(settings.instagram_url),
          tiktok_url: blankToNull(settings.tiktok_url),
          facebook_url: blankToNull(settings.facebook_url),
        })
        .eq('id', true)
        .select('fx_updated_at')
        .single(),
      this.supabase.from('delivery_zones').upsert(
        zones.map((zone) => ({
          ...zone,
          est_days: blankToNull(zone.est_days),
        })),
        { onConflict: 'country' },
      ),
    ]);

    this.saving.set(false);
    if (s.error || z.error) {
      this.message.set({ kind: 'error', text: 'Couldn’t save. Nothing was changed — try again.' });
      return;
    }
    this.fxAgeDays.set(daysSince(s.data.fx_updated_at));
    this.form.markAsPristine();
    this.message.set({ kind: 'ok', text: 'Saved.' });
  }

  private async load(): Promise<void> {
    const [s, z] = await Promise.all([
      this.supabase.from('settings').select('*').eq('id', true).single<SettingsRow>(),
      this.supabase.from('delivery_zones').select('*').order('country').returns<ZoneRow[]>(),
    ]);
    if (s.error || z.error) throw new Error('load failed');

    const { fx_updated_at, ...row } = s.data;
    this.form.patchValue({
      ...row,
      mkd_per_eur: Number(row.mkd_per_eur),
      all_per_eur: Number(row.all_per_eur),
      mkd_rounding: Number(row.mkd_rounding),
      all_rounding: Number(row.all_rounding),
      default_markup_pct: Number(row.default_markup_pct),
      contact_phone: row.contact_phone ?? '',
      contact_email: row.contact_email ?? '',
      instagram_url: row.instagram_url ?? '',
      tiktok_url: row.tiktok_url ?? '',
      facebook_url: row.facebook_url ?? '',
    });
    // Kosovo first: that's where the stock is.
    const order: Country[] = ['XK', 'MK', 'AL'];
    for (const zone of [...(z.data ?? [])].sort((a, b) => order.indexOf(a.country) - order.indexOf(b.country))) {
      this.zones.push(zoneGroup(this.fb, zone));
    }
    this.fxAgeDays.set(daysSince(fx_updated_at));
    this.form.markAsPristine();
    this.state.set('ready');
  }

  protected readonly staleFxDays = STALE_FX_DAYS;
}

function zoneGroup(fb: NonNullableFormBuilder, zone: ZoneRow) {
  return fb.group({
    country: fb.control(zone.country),
    currency: fb.control(zone.currency),
    fee_eur: fb.control(Number(zone.fee_eur), [Validators.required, Validators.min(0)]),
    // An empty number input reads as null: no free-delivery threshold.
    free_over_eur: fb.control<number | null>(zone.free_over_eur === null ? null : Number(zone.free_over_eur), Validators.min(0)),
    est_days: fb.control(zone.est_days ?? ''),
    active: fb.control(zone.active),
  });
}

type ZoneGroup = ReturnType<typeof zoneGroup>;

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}
