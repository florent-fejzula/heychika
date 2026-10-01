// Sticker sheet layouts. Dimensions are real millimetres so what's on screen is
// what comes out of the printer, as long as the printer prints at 100% scale.

export interface LabelLayout {
  id: string;
  name: string;
  /** Page size in mm. */
  pageWidth: number;
  pageHeight: number;
  /** Label size in mm. */
  width: number;
  height: number;
  columns: number;
  rows: number;
  /** Gap between labels, and offset of the first label from the page corner, in mm. */
  gapX: number;
  gapY: number;
  marginTop: number;
  marginLeft: number;
}

// Common sheet and roll formats. Match the one to the label paper that was bought.
// Nothing narrower than ~45 mm is offered: a 12-14 character Code128 barcode squeezed
// into 38 mm stops decoding reliably at 300 dpi (measured), and you only find out after
// a whole sheet is printed and stuck on.
export const LAYOUTS: LabelLayout[] = [
  {
    id: 'a4-24',
    name: 'A4 sheet · 24 labels (3 × 8, 63.5 × 33.9 mm)',
    pageWidth: 210, pageHeight: 297, width: 63.5, height: 33.9, columns: 3, rows: 8,
    gapX: 2.5, gapY: 0, marginTop: 13, marginLeft: 7.2,
  },
  {
    id: 'a4-44',
    name: 'A4 sheet · 44 small labels (4 × 11, 45.7 × 25.4 mm)',
    pageWidth: 210, pageHeight: 297, width: 45.7, height: 25.4, columns: 4, rows: 11,
    gapX: 2.8, gapY: 0, marginTop: 8.8, marginLeft: 9.7,
  },
  {
    id: 'roll-50x30',
    name: 'Label printer roll · 50 × 30 mm, one per page',
    pageWidth: 50, pageHeight: 30, width: 50, height: 30, columns: 1, rows: 1,
    gapX: 0, gapY: 0, marginTop: 0, marginLeft: 0,
  },
];

export function labelsPerPage(layout: LabelLayout): number {
  return layout.columns * layout.rows;
}

/**
 * Splits labels into pages. `skip` leaves that many positions empty at the start,
 * so a half-used sheet can be reused.
 */
export function paginate<T>(items: T[], layout: LabelLayout, skip = 0): (T | null)[][] {
  const perPage = labelsPerPage(layout);
  const start = Math.min(Math.max(0, Math.floor(skip)), perPage - 1);
  const slots: (T | null)[] = [...Array<null>(start).fill(null), ...items];
  const pages: (T | null)[][] = [];
  for (let i = 0; i < slots.length; i += perPage) {
    pages.push(slots.slice(i, i + perPage));
  }
  return pages;
}
