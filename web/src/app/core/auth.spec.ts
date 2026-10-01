import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot, Router, UrlTree, provideRouter } from '@angular/router';
import { Auth, safeNext, staffGuard } from './auth';

describe('safeNext', () => {
  it('returns to the admin page the user was trying to reach', () => {
    expect(safeNext('/admin/settings')).toBe('/admin/settings');
    expect(safeNext('/admin')).toBe('/admin');
    expect(safeNext('/admin?tab=x')).toBe('/admin?tab=x');
  });

  it('never redirects outside the admin', () => {
    expect(safeNext('https://evil.example')).toBe('/admin');
    expect(safeNext('//evil.example')).toBe('/admin');
    expect(safeNext('/administrator-phish')).toBe('/admin');
    expect(safeNext(null)).toBe('/admin');
  });
});

describe('staffGuard', () => {
  function runGuard(isStaff: boolean, url = '/admin/settings') {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Auth, useValue: { ready: () => Promise.resolve(), isStaff: () => isStaff } },
      ],
    });
    return TestBed.runInInjectionContext(() =>
      staffGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    ) as Promise<boolean | UrlTree>;
  }

  it('lets staff through', async () => {
    expect(await runGuard(true)).toBe(true);
  });

  it('sends everyone else to the login, remembering where they were going', async () => {
    const result = await runGuard(false, '/admin/settings');
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/admin/login?next=%2Fadmin%2Fsettings');
  });
});
