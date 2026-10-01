import { TestBed } from '@angular/core/testing';
import { Bag, MAX_PER_ITEM } from './bag';

describe('Bag', () => {
  beforeEach(() => localStorage.clear());

  function bag(): Bag {
    const b = TestBed.inject(Bag);
    b.restore();
    return b;
  }

  it('adds items, and adding the same one again raises its quantity', () => {
    const b = bag();
    b.add(7);
    b.add(9, 2);
    b.add(7);
    expect(b.lines()).toEqual([{ variantId: 7, qty: 2 }, { variantId: 9, qty: 2 }]);
    expect(b.count()).toBe(4);
  });

  it('never goes over the per-item limit the checkout accepts', () => {
    const b = bag();
    expect(b.add(7, 4)).toBe(4);
    expect(b.add(7, 4)).toBe(MAX_PER_ITEM);
    b.set(7, 99);
    expect(b.qtyOf(7)).toBe(MAX_PER_ITEM);
  });

  it('removes an item when its quantity goes to zero', () => {
    const b = bag();
    b.add(7);
    b.set(7, 0);
    expect(b.lines()).toEqual([]);
  });

  it('is remembered in this browser', () => {
    bag().add(7, 2);
    TestBed.resetTestingModule();
    expect(bag().lines()).toEqual([{ variantId: 7, qty: 2 }]);
  });

  it('starts empty, rather than breaking, when what was saved is junk', () => {
    localStorage.setItem('hc_bag', '{"not":"a bag"}');
    expect(bag().lines()).toEqual([]);
    TestBed.resetTestingModule();
    localStorage.setItem('hc_bag', 'not even json');
    expect(bag().lines()).toEqual([]);
    TestBed.resetTestingModule();
    localStorage.setItem('hc_bag', '[{"variantId":7,"qty":-3}]');
    expect(bag().lines()).toEqual([]);
  });

  it('empties after an order', () => {
    const b = bag();
    b.add(7);
    b.clear();
    expect(b.count()).toBe(0);
    expect(localStorage.getItem('hc_bag')).toBe('[]');
  });
});
