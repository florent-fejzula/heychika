import { TestBed } from '@angular/core/testing';
import { explain } from './errors';
import { I18n } from './i18n';

// The words come from the English translations (src/test-providers.ts).
beforeEach(() => TestBed.inject(I18n));

describe('explain', () => {
  it('translates the database’s own error codes', () => {
    expect(explain({ message: 'variant_locked', details: 'SKU X has history' })).toContain('stock history');
    expect(explain({ message: 'code_in_use' })).toContain('part of existing SKUs');
    expect(explain({ message: 'permission denied for table orders', code: '42501' })).toContain('don’t have access');
  });

  it('explains duplicates and in-use rows by their Postgres codes', () => {
    expect(explain({ code: '23505', message: 'duplicate key value' })).toBe('That already exists.');
    expect(explain({ code: '23503', message: 'violates foreign key' })).toContain('still in use');
  });

  it('recognises a dropped connection', () => {
    expect(explain(new TypeError('Failed to fetch'))).toContain('Check your connection');
  });

  it('never shows raw technical text to the user', () => {
    expect(explain({ message: 'syntax error at or near "select"' })).toBe('Something went wrong. Try again.');
    expect(explain(undefined, 'errors.save')).toBe('Couldn’t save.');
  });
});
