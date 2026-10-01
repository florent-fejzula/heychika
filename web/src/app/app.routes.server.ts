import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // The admin depends on the logged-in user, which only exists in the browser.
  { path: 'admin', renderMode: RenderMode.Client },
  { path: 'admin/**', renderMode: RenderMode.Client },

  // The bag, checkout and order pages are built from what's saved in this
  // browser (the bag, the order just placed). The server has none of it, and
  // nobody shares these links, so there's nothing to gain from rendering them there.
  { path: 'bag', renderMode: RenderMode.Client },
  { path: 'checkout', renderMode: RenderMode.Client },
  { path: 'order', renderMode: RenderMode.Client },
  { path: 'order/**', renderMode: RenderMode.Client },

  // The shop renders on the server per request, so prices and stock are live,
  // the first paint is fast on mobile data, and a product link pasted into a DM
  // gets a preview card. Not prerendered: that would bake in whatever the
  // database held at build time.
  { path: '**', renderMode: RenderMode.Server },
];
