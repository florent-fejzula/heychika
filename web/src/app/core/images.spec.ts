import { fitWithin, thumbPath } from './images';

describe('fitWithin', () => {
  it('shrinks a landscape photo by its long edge', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it('shrinks a portrait photo by its long edge', () => {
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('never enlarges a small image', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('never collapses a thin image to zero', () => {
    expect(fitWithin(10000, 2, 1600).height).toBe(1);
  });
});

describe('thumbPath', () => {
  it('names the small copy next to the full one', () => {
    expect(thumbPath('12/abc.jpg')).toBe('12/abc_t.jpg');
  });
});
