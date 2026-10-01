import { LAYOUTS, labelsPerPage, paginate } from './labels';

const a4 = LAYOUTS.find((l) => l.id === 'a4-24')!;

describe('labels', () => {
  it('counts labels per page from the grid', () => {
    expect(labelsPerPage(a4)).toBe(24);
  });

  it('fits every sheet layout on its page', () => {
    for (const l of LAYOUTS) {
      const usedWidth = l.marginLeft + l.columns * l.width + (l.columns - 1) * l.gapX;
      const usedHeight = l.marginTop + l.rows * l.height + (l.rows - 1) * l.gapY;
      expect(usedWidth).toBeLessThanOrEqual(l.pageWidth);
      expect(usedHeight).toBeLessThanOrEqual(l.pageHeight);
    }
  });

  it('splits into pages and keeps the order', () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const pages = paginate(items, a4);
    expect(pages.length).toBe(2);
    expect(pages[0].length).toBe(24);
    expect(pages[1]).toEqual([24, 25, 26, 27, 28, 29]);
  });

  it('can skip the labels already used on a part-used sheet', () => {
    const pages = paginate(['a', 'b'], a4, 3);
    expect(pages[0].slice(0, 5)).toEqual([null, null, null, 'a', 'b']);
  });

  it('pushes overflow onto a second page when skipping', () => {
    const pages = paginate(Array.from({ length: 23 }, (_, i) => i), a4, 2);
    expect(pages.length).toBe(2);
    expect(pages[1]).toEqual([22]);
  });

  it('never skips past the end of a page', () => {
    expect(paginate(['a'], a4, 999)[0].indexOf('a')).toBe(23);
  });

  it('makes no pages for no labels', () => {
    expect(paginate([], a4)).toEqual([]);
  });
});
