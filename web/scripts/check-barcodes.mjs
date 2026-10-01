// Proves that the barcodes we print can be read back by the scanner the admin uses.
//
//   npm run check:barcodes
//
// For each label layout it renders real SKUs the way the app does, shrinks them to the
// width they will have on paper at 300 dpi, and decodes them with the same library the
// camera scanner uses. Run it after changing barcode options or adding a label layout:
// an unscannable sticker only shows up after a whole sheet is printed and stuck on.
//
// Keep BARCODE_OPTIONS in step with src/app/core/barcode.ts, and LABEL_WIDTHS_MM with
// src/app/core/labels.ts.

import bwipjs from 'bwip-js/node';
import { PNG } from 'pngjs';
import zxing from '@zxing/library';

const { MultiFormatReader, BarcodeFormat, DecodeHintType, RGBLuminanceSource, BinaryBitmap, HybridBinarizer } = zxing;

const BARCODE_OPTIONS = { bcid: 'code128', scale: 4, height: 12, includetext: false, paddingwidth: 4, paddingheight: 0, backgroundcolor: 'FFFFFF' };
const LABEL_WIDTHS_MM = { 'A4 24-up': 63.5, 'A4 44-up': 45.7, 'Roll 50x30': 50 };
const BARCODE_AREA = 0.9; // the label keeps 5% padding on each side (see labels.scss)
const DPI = 300;

// Long ones: the longest SKU a category + 3-digit model + colour + size can make.
const SKUS = ['DR-001-BLK-M', 'DR-012-RED-XXL', 'ST-100-MLT-OS', 'JN-003-NVY-38', 'TS-007-CRM-XXL', 'KN-999-BRD-XXL'];

const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]]]);

function shrink({ width, height, data }, outW) {
  const outH = Math.max(1, Math.round((height * outW) / width));
  const lum = new Uint8ClampedArray(outW * outH);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const x0 = Math.floor((x * width) / outW);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / outW));
      const y0 = Math.floor((y * height) / outH);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / outH));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * width + xx) * 4;
          sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          n++;
        }
      }
      lum[y * outW + x] = sum / n;
    }
  }
  return { lum, outW, outH };
}

function decode({ lum, outW, outH }) {
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  const quiet = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = () => {}; // the library narrates every miss
  try {
    return reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, outW, outH)))).getText();
  } catch {
    return null;
  } finally {
    [console.log, console.warn, console.error] = quiet;
  }
}

let failures = 0;
for (const [layout, labelMm] of Object.entries(LABEL_WIDTHS_MM)) {
  const outW = Math.round(((labelMm * BARCODE_AREA) / 25.4) * DPI);
  const bad = [];
  for (const text of SKUS) {
    const png = PNG.sync.read(await bwipjs.toBuffer({ ...BARCODE_OPTIONS, text }));
    if (decode(shrink(png, outW)) !== text) bad.push(text);
  }
  failures += bad.length;
  console.log(`${bad.length ? 'FAIL' : 'ok  '} ${layout.padEnd(12)} ${labelMm} mm${bad.length ? `  unreadable: ${bad.join(', ')}` : ''}`);
}

if (failures) {
  console.error('\nSome barcodes would not scan at print size. Use a wider label or a shorter SKU.');
  process.exit(1);
}
console.log('\nEvery SKU scans back exactly, on every layout.');
