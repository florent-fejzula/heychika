// Writes Excel (.xlsx) files in the browser, with no library.
//
// An .xlsx file is a zip of a few XML files. This writes the smallest set Excel,
// Numbers and Google Sheets all open without complaint: one sheet per table, a
// bold header row that stays put when scrolling, sensible column widths, and
// real numbers and dates (so sums and filters work), not text that looks like them.
//
// Why not a library: the common one (SheetJS) is no longer updated on npm and has
// open security advisories there; the rest are large for what's needed here.
// CSV isn't an option either: Excel set up for these countries expects semicolons
// and mangles ë and ç unless the file is just so.

export type CellValue = string | number | null | undefined;

/**
 * text     as it is
 * int      a whole number, 1,234
 * money    two decimals, 1,234.50 (amounts in any currency)
 * date     a calendar date, given as 'YYYY-MM-DD'
 * percent  a fraction, 0.425 shows as 42.5%
 */
export type ColumnKind = 'text' | 'int' | 'money' | 'date' | 'percent';

export interface Column {
  header: string;
  kind?: ColumnKind;
  /** In characters. Worked out from the contents when left out. */
  width?: number;
}

export interface Sheet {
  name: string;
  columns: Column[];
  rows: CellValue[][];
  /** An optional last row in bold, e.g. the totals. */
  totals?: CellValue[];
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The whole .xlsx file. */
export function workbook(sheets: Sheet[]): Uint8Array {
  if (!sheets.length) throw new Error('A workbook needs at least one sheet.');
  const names = sheetNames(sheets.map((s) => s.name));
  const files: [string, string][] = [
    ['[Content_Types].xml', contentTypes(sheets.length)],
    ['_rels/.rels', ROOT_RELS],
    ['xl/workbook.xml', workbookXml(names)],
    ['xl/_rels/workbook.xml.rels', workbookRels(sheets.length)],
    ['xl/styles.xml', STYLES],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  const encoder = new TextEncoder();
  return zip(files.map(([name, xml]) => ({ name, data: encoder.encode(xml) })));
}

/** Saves the workbook to the phone or computer (on an iPhone, it opens to share or save). */
export function downloadWorkbook(filename: string, sheets: Sheet[]): void {
  const bytes = workbook(sheets);
  const blob = new Blob([bytes as BlobPart], { type: XLSX_TYPE });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Some browsers read the file after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------------------------------------------------------------------------
// Sheets

// Style ids, matching the order of <cellXfs> in STYLES below.
const STYLE: Record<ColumnKind, number> = { text: 0, int: 2, money: 3, date: 4, percent: 5 };
const BOLD = 1;
const BOLD_OF: Record<ColumnKind, number> = { text: 1, int: 6, money: 7, date: 8, percent: 9 };

function sheetXml(sheet: Sheet): string {
  const kinds = sheet.columns.map((c) => c.kind ?? 'text');
  const rows: string[] = [];

  rows.push(row(1, sheet.columns.map((c, i) => cell(ref(i, 1), c.header, 'text', BOLD))));
  sheet.rows.forEach((values, r) => {
    rows.push(row(r + 2, kinds.map((kind, i) => cell(ref(i, r + 2), values[i], kind, STYLE[kind]))));
  });
  if (sheet.totals) {
    const n = sheet.rows.length + 2;
    rows.push(row(n, kinds.map((kind, i) => cell(ref(i, n), sheet.totals![i], kind, BOLD_OF[kind]))));
  }

  const cols = sheet.columns
    .map((c, i) => {
      const width = c.width ?? autoWidth(c, sheet, i);
      return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
    })
    .join('');

  return (
    XML_HEAD +
    `<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>' +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${rows.join('')}</sheetData>` +
    '</worksheet>'
  );
}

function row(n: number, cells: string[]): string {
  return `<row r="${n}">${cells.join('')}</row>`;
}

function cell(at: string, value: CellValue, kind: ColumnKind, style: number): string {
  if (value === null || value === undefined || value === '') return '';
  const s = style ? ` s="${style}"` : '';

  if (typeof value === 'number') {
    return Number.isFinite(value) ? `<c r="${at}"${s}><v>${value}</v></c>` : '';
  }
  if (kind === 'date') {
    const serial = dateSerial(value);
    if (serial !== null) return `<c r="${at}"${s}><v>${serial}</v></c>`;
  }
  // Text. A text cell in a number column keeps the column's style but shows as typed.
  const text = clean(value);
  const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  return `<c r="${at}"${s} t="inlineStr"><is><t${space}>${escapeXml(text)}</t></is></c>`;
}

/** 'YYYY-MM-DD' to Excel's day number (days since 30 Dec 1899). */
export function dateSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const days = (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86_400_000;
  return Number.isFinite(days) ? days : null;
}

/** Column index (0-based) and row number to an A1-style reference. */
export function ref(col: number, rowNumber: number): string {
  let name = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name + rowNumber;
}

function autoWidth(column: Column, sheet: Sheet, i: number): number {
  const kind = column.kind ?? 'text';
  let longest = column.header.length;
  for (const r of [...sheet.rows, sheet.totals ?? []]) {
    const v = r[i];
    if (v === null || v === undefined) continue;
    const shown =
      typeof v === 'number'
        ? kind === 'money'
          ? v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : kind === 'percent'
            ? '100.0%'
            : v.toLocaleString('en-GB')
        : kind === 'date'
          ? '00.00.0000'
          : String(v);
    longest = Math.max(longest, shown.length);
  }
  return Math.min(60, Math.max(8, longest + 2));
}

/** Excel's rules: 1–31 characters, none of []:*?/\, unique regardless of case. */
export function sheetNames(wanted: string[]): string[] {
  const used = new Set<string>();
  return wanted.map((name, i) => {
    const base = name.replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || `Sheet${i + 1}`;
    let candidate = base;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      candidate = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

// Characters XML 1.0 can't hold at all (control characters pasted from somewhere).
function clean(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// The fixed parts

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

function contentTypes(sheetCount: number): string {
  const sheets = Array.from(
    { length: sheetCount },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('');
  return (
    XML_HEAD +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets +
    '</Types>'
  );
}

const ROOT_RELS =
  XML_HEAD +
  `<Relationships xmlns="${PKG_REL_NS}">` +
  `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
  '</Relationships>';

function workbookXml(names: string[]): string {
  const sheets = names.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  return XML_HEAD + `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets>${sheets}</sheets></workbook>`;
}

function workbookRels(sheetCount: number): string {
  const sheets = Array.from(
    { length: sheetCount },
    (_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join('');
  return (
    XML_HEAD +
    `<Relationships xmlns="${PKG_REL_NS}">` +
    sheets +
    `<Relationship Id="rId${sheetCount + 1}" Type="${REL_NS}/styles" Target="styles.xml"/>` +
    '</Relationships>'
  );
}

// cellXfs, in order: 0 plain, 1 bold, 2 int, 3 money, 4 date, 5 percent,
// then bold versions of 6 int, 7 money, 8 date, 9 percent.
const STYLES =
  XML_HEAD +
  `<styleSheet xmlns="${MAIN_NS}">` +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="10">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '<xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

// ---------------------------------------------------------------------------
// Zip, uncompressed ("stored"). The files here are small; compressing them
// isn't worth the code.

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export function zip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header
    lv.setUint16(4, 20, true); // version needed: 2.0
    lv.setUint16(6, 0x0800, true); // names are UTF-8
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, 0, true); // time 00:00
    lv.setUint16(12, 0x21, true); // date 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory header
    cv.setUint16(4, 20, true); // made by
    cv.setUint16(6, 20, true); // needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    // extra, comment, disk, internal and external attributes: all 0
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, entry.data);
    centrals.push(central);
    offset += local.length + size;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

let crcTable: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
