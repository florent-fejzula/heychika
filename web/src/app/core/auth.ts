import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Session } from '@supabase/supabase-js';
import { Supabase } from './supabase';

export interface StaffProfile {
  id: string;
  name: string;
  role: 'owner' | 'staff';
}

export type SignInResult = 'ok' | 'invalid' | 'not_staff';

// Being logged in is not enough: a user is staff only if they have a row in
// public.profiles. The database enforces the same rule on every query.
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly supabase = inject(Supabase).client;
  private ready$: Promise<void> | null = null;

  readonly session = signal<Session | null>(null);
  readonly staff = signal<StaffProfile | null>(null);
  readonly isStaff = computed(() => this.staff() !== null);

  ready(): Promise<void> {
    this.ready$ ??= this.restore();
    return this.ready$;
  }

  async signIn(email: string, password: string): Promise<SignInResult> {
    const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) return 'invalid';

    await this.load(data.session);
    if (!this.staff()) {
      await this.signOut();
      return 'not_staff';
    }
    return 'ok';
  }

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
    this.session.set(null);
    this.staff.set(null);
  }

  private async restore(): Promise<void> {
    const { data } = await this.supabase.auth.getSession();
    await this.load(data.session);

    // Don't query Supabase from inside this callback: supabase-js holds a lock
    // while it runs, and a nested call can deadlock.
    this.supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        this.session.set(null);
        this.staff.set(null);
      } else if (event === 'TOKEN_REFRESHED') {
        this.session.set(session);
      }
    });
  }

  private async load(session: Session | null): Promise<void> {
    this.session.set(session);
    if (!session) {
      this.staff.set(null);
      return;
    }
    const { data } = await this.supabase
      .from('profiles')
      .select('id, name, role')
      .eq('id', session.user.id)
      .maybeSingle<StaffProfile>();
    this.staff.set(data);
  }
}

export const staffGuard: CanActivateFn = async (_route, state) => {
  // inject() only works before the first await, so grab everything up front.
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.ready();
  return auth.isStaff() || router.createUrlTree(['/admin/login'], { queryParams: { next: state.url } });
};

// Only ever redirect back into the admin, never to an arbitrary URL from the query string.
export function safeNext(next: string | null): string {
  return next && /^\/admin(\/|$|\?)/.test(next) ? next : '/admin';
}
