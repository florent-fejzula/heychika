import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth, safeNext } from '../../core/auth';
import { TranslatePipe } from '../../core/i18n';
import { supabaseConfigured } from '../../core/supabase';
import { LangPicker } from '../../shared/lang-picker';

const MESSAGES = {
  invalid: 'admin.login.invalid',
  not_staff: 'admin.login.notStaff',
  offline: 'errors.offline',
} as const;

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, TranslatePipe, LangPicker],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly configured = supabaseConfigured;
  protected readonly busy = signal(false);
  /** A translation key. */
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);

    try {
      const { email, password } = this.form.getRawValue();
      const result = await this.auth.signIn(email.trim(), password);
      if (result === 'ok') {
        await this.router.navigateByUrl(safeNext(this.route.snapshot.queryParamMap.get('next')));
      } else {
        this.error.set(MESSAGES[result]);
      }
    } catch {
      this.error.set(MESSAGES.offline);
    } finally {
      this.busy.set(false);
    }
  }
}
