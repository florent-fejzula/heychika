import { DOCUMENT, DestroyRef, Injectable, inject, signal } from '@angular/core';
import { NavigationError } from '@angular/router';

/**
 * Tells the person when a newer version has been released.
 *
 * A page left open keeps running the version it was loaded with, and on a phone
 * that can be days: the browser resumes the tab from the background rather than
 * loading it again. So the app asks the server which build it's running (when it
 * comes back to the screen, and every half hour) and offers a refresh when it
 * differs. Refreshing is left to her, not done for her, because it would throw
 * away a half-filled form.
 *
 * A build is named by its main script and stylesheet: their file names carry a
 * hash of the contents, so they change with every release. The server lists its
 * own at /app-version (see src/server.ts).
 */
@Injectable({ providedIn: 'root' })
export class AppUpdate {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  /** True once a newer version is out. */
  readonly available = signal(false);

  private loaded: string[] = [];
  private lastCheck = 0;

  /** Called once, in the browser. Does nothing on the development server, whose files have no hashes. */
  start(): void {
    this.loaded = buildFiles(
      [...this.document.querySelectorAll<HTMLScriptElement>('script[src]')].map((s) => s.getAttribute('src') ?? ''),
      [...this.document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet][href]')].map((l) => l.getAttribute('href') ?? ''),
    );
    if (!this.loaded.length) return;

    const onVisible = () => {
      if (this.document.visibilityState === 'visible') void this.check();
    };
    this.document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => void this.check(), 30 * 60_000);
    this.destroyRef.onDestroy(() => {
      this.document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    });
  }

  async check(): Promise<void> {
    // At most once a minute: switching apps back and forth shouldn't send a request each time.
    if (this.available() || Date.now() - this.lastCheck < 60_000) return;
    this.lastCheck = Date.now();
    try {
      const response = await fetch('/app-version', { cache: 'no-store' });
      if (!response.ok) return;
      const { files } = (await response.json()) as { files?: unknown };
      if (Array.isArray(files) && files.length && this.loaded.some((f) => !files.includes(f))) {
        this.available.set(true);
      }
    } catch {
      // Offline, or the server is mid-release. The next check will tell.
    }
  }

  reload(): void {
    this.document.location.reload();
  }
}

/** The build's own files among the page's scripts and stylesheets: main-HASH.js, styles-HASH.css. */
export function buildFiles(scripts: string[], styles: string[]): string[] {
  const names = [...scripts, ...styles].map((src) => src.split('/').pop()?.split('?')[0] ?? '');
  return [...new Set(names.filter((n) => /^(main|styles)-[A-Z0-9]+\.(js|css)$/.test(n)))].sort();
}

/**
 * After a release the old version's files are gone from the server, so a page
 * opened before it can't load the screens it hasn't shown yet. Instead of an
 * error, load the page it was going to afresh, which brings the new version.
 * Once: if that fails too, it's something else, and the error shows as usual.
 */
export function reloadOnStaleChunk(error: NavigationError): void {
  const message = String((error.error as Error | undefined)?.message ?? error.error ?? '');
  if (!/dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(message)) return;

  const document = inject(DOCUMENT);
  const window = document.defaultView;
  if (!window) return;
  try {
    const last = Number(window.sessionStorage.getItem('reloaded-for-update') ?? 0);
    if (Date.now() - last < 30_000) return;
    window.sessionStorage.setItem('reloaded-for-update', String(Date.now()));
  } catch {
    // Storage blocked: reload anyway. Without the guard a second failure would reload again.
  }
  window.location.assign(error.url);
}
