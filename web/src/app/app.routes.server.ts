import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // The admin depends on the logged-in user, which only exists in the browser.
  { path: 'admin', renderMode: RenderMode.Client },
  { path: 'admin/**', renderMode: RenderMode.Client },

  // The shop renders on the server per request, so prices and stock are live and
  // the first paint is fast on mobile data. Not prerendered: that would bake in
  // whatever the database held at build time.
  { path: '**', renderMode: RenderMode.Server },
];
