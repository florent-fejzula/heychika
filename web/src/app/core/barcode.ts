// Code128 barcodes encoding the SKU. Rendered to a PNG data URL: an <img> can't
// run scripts, and PNG prints crisply. The library loads on first use so it
// isn't part of the main bundle.

const cache = new Map<string, string>();

// Code128 can carry any printable ASCII; our SKUs are A-Z, 0-9 and hyphens.
// Anything else (a hand-typed barcode) is allowed through but must stay printable.
export function isPrintable(text: string): boolean {
  return /^[\x20-\x7e]{1,40}$/.test(text);
}

export async function barcodeImage(text: string): Promise<string> {
  const hit = cache.get(text);
  if (hit) return hit;
  if (!isPrintable(text)) throw new Error('barcode text must be 1-40 printable characters');

  const bwip = await import('bwip-js/browser');
  const canvas = document.createElement('canvas');
  bwip.toCanvas(canvas, {
    bcid: 'code128',
    text,
    scale: 4, // dense enough for a 300 dpi label printer, still light as a PNG
    height: 12,
    includetext: false,
    paddingwidth: 4, // quiet zone: scanners need blank space either side
    paddingheight: 0,
    backgroundcolor: 'FFFFFF', // opaque white: a transparent PNG can read as solid black to some scanners and printers
  });
  const url = canvas.toDataURL('image/png');
  cache.set(text, url);
  return url;
}
