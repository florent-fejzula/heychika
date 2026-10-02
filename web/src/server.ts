import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

app.disable('x-powered-by');

/**
 * Security headers on every response.
 *
 * - No other site may show these pages in a frame, so the admin can't be
 *   overlaid with a fake page that tricks a click (clickjacking).
 * - Browsers must not guess file types, and links to other sites don't carry
 *   the full address (order numbers are in some of them).
 * - The camera is for scanning barcodes in the admin; nothing else gets it.
 * - HTTPS only, once a browser has seen the site over HTTPS.
 *
 * Deliberately no script-src policy: the server-rendered pages carry inline
 * scripts (the data handed to the browser, event replay), and the risk it
 * guards against is already covered by Angular escaping everything it shows.
 */
app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});

/**
 * Hosting puts a proxy in front of this server, which adds X-Forwarded-* headers
 * (the visitor's IP, the port, and more). Angular trusts only -host and -proto; any
 * other one makes it play safe and send the page unrendered, so it loads slower and
 * shared product links lose their preview. Nothing here uses the others, so they
 * are dropped before Angular sees the request. -host is still checked against
 * NG_ALLOWED_HOSTS.
 */
app.use((req, _res, next) => {
  for (const name of Object.keys(req.headers)) {
    if (name.startsWith('x-forwarded-') && name !== 'x-forwarded-host' && name !== 'x-forwarded-proto') {
      delete req.headers[name];
    }
  }
  next();
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
