import { allRows } from './supabase';

// A table of 7 rows behind a server that hands back at most `cap` per request.
function table(cap: number) {
  const rows = Array.from({ length: 7 }, (_, i) => i + 1);
  const asked: [number, number][] = [];
  const page = async (from: number, to: number) => {
    asked.push([from, to]);
    return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null };
  };
  return { page, asked };
}

describe('allRows', () => {
  it('asks page after page until there are no more', async () => {
    const { page, asked } = table(3);
    expect(await allRows(page, 3)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(asked).toEqual([[0, 2], [3, 5], [6, 8], [7, 9]]);
  });

  it('still gets everything when the server hands back fewer rows than asked for', async () => {
    const { page } = table(2);
    expect(await allRows(page, 5)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('stops at the first error', async () => {
    const boom = { message: 'permission denied' };
    await expect(allRows(async () => ({ data: null, error: boom }))).rejects.toBe(boom);
  });
});
