import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { UpdateBanner } from '../shared/update-banner';
import { AppUpdate, buildFiles } from './app-update';

describe('buildFiles', () => {
  it('picks the hashed main script and stylesheet out of the page', () => {
    expect(
      buildFiles(['main-3MEWUIS4.js', '/chunk-ABC.js', 'https://cdn.example/x.js'], ['styles-TVHUM7FE.css', 'https://fonts.googleapis.com/css2?x']),
    ).toEqual(['main-3MEWUIS4.js', 'styles-TVHUM7FE.css']);
  });

  it('finds nothing on the development server, whose files have no hashes', () => {
    expect(buildFiles(['main.js', 'polyfills.js'], ['styles.css'])).toEqual([]);
  });
});

describe('AppUpdate', () => {
  let script: HTMLScriptElement;

  beforeEach(() => {
    script = document.createElement('script');
    script.setAttribute('src', 'main-OLD11111.js');
    document.head.appendChild(script);
  });

  afterEach(() => {
    script.remove();
    vi.unstubAllGlobals();
  });

  function serverHas(files: string[] | 'down') {
    const fetch = vi.fn(async () =>
      files === 'down' ? Promise.reject(new TypeError('Failed to fetch')) : new Response(JSON.stringify({ files })),
    );
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }

  it('stays quiet while the server runs the same build', async () => {
    const fetch = serverHas(['main-OLD11111.js']);
    const update = TestBed.inject(AppUpdate);
    update.start();
    await update.check();
    expect(fetch).toHaveBeenCalledWith('/app-version', { cache: 'no-store' });
    expect(update.available()).toBe(false);
  });

  it('offers a refresh once a new build is out, and the banner says so', async () => {
    serverHas(['main-NEW22222.js']);
    const update = TestBed.inject(AppUpdate);
    update.start();
    await update.check();
    expect(update.available()).toBe(true);

    const reload = vi.spyOn(update, 'reload').mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(UpdateBanner);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('A new version of the app is available.');
    el.querySelector<HTMLButtonElement>('.btn-primary')!.click();
    expect(reload).toHaveBeenCalled();

    // "Not now" hides it.
    el.querySelector<HTMLButtonElement>('.close')!.click();
    await fixture.whenStable();
    expect(el.querySelector('.banner')).toBeNull();
  });

  it('keeps going if the server can’t be reached, and asks at most once a minute', async () => {
    const fetch = serverHas('down');
    const update = TestBed.inject(AppUpdate);
    update.start();
    await update.check();
    await update.check();
    expect(update.available()).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does nothing on the development server', async () => {
    script.setAttribute('src', 'main.js');
    const fetch = serverHas(['main-NEW22222.js']);
    const update = TestBed.inject(AppUpdate);
    update.start();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetch).not.toHaveBeenCalled();
  });
});
