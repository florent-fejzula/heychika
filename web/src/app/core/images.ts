// Phone photos are 3-10 MB. Shrinking them before upload keeps the shop fast on
// mobile data and the storage bill at zero. Each photo is stored twice: a full
// size one for the product page and a small one for lists and grids.

export const FULL_EDGE = 1600;
export const THUMB_EDGE = 480;
const JPEG_QUALITY = 0.85;

/** Scale to fit within max x max, never enlarging, keeping the aspect ratio. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** `12/abc.jpg` -> `12/abc_t.jpg` */
export function thumbPath(path: string): string {
  return path.replace(/\.jpg$/i, '_t.jpg');
}

export interface PreparedImage {
  full: Blob;
  thumb: Blob;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  // imageOrientation applies the phone's rotation flag, so portrait shots stay upright.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    return {
      full: await render(bitmap, FULL_EDGE),
      thumb: await render(bitmap, THUMB_EDGE),
    };
  } finally {
    bitmap.close();
  }
}

async function render(bitmap: ImageBitmap, max: number): Promise<Blob> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.fillStyle = '#fff'; // JPEG has no transparency; flatten PNGs onto white, not black
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not encode image'))), 'image/jpeg', JPEG_QUALITY),
  );
}

/**
 * The photos in a paste (Ctrl+V of a screenshot or a copied image), or none.
 *
 * Pasting into a text box keeps its text: copying from Excel or Word puts a
 * picture of the text on the clipboard too, and that's not a photo of the item.
 */
export function pastedImages(event: ClipboardEvent): File[] {
  const data = event.clipboardData;
  if (!data) return [];
  const target = event.target as HTMLElement | null;
  const typing = !!target?.closest('input:not([type=file]):not([type=checkbox]):not([type=radio]), textarea, [contenteditable=""], [contenteditable=true]');
  if (typing && data.types.includes('text/plain')) return [];
  return [...data.files].filter((f) => f.type.startsWith('image/'));
}
