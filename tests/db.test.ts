import { describe, it, expect } from 'vitest';
import { generateId, slugify, generateSlug } from '../src/lib/db';

describe('generateId', () => {
  it('returns a valid UUID string', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('returns unique values on successive calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe('slugify', () => {
  it('converts text to lowercase with hyphens', () => {
    expect(slugify('Best NAS Under 500')).toBe('best-nas-under-500');
  });

  it('removes special characters', () => {
    expect(slugify('What\'s the best $500 router?')).toBe('what-s-the-best-500-router');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('one---two---three')).toBe('one-two-three');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify('---hello world---')).toBe('hello-world');
  });

  it('truncates to 80 characters', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });
});

describe('generateSlug', () => {
  it('creates a slug from query with a random suffix', () => {
    const slug = generateSlug('best mechanical keyboard');
    expect(slug).toMatch(/^best-mechanical-keyboard-[a-f0-9]{8}$/);
  });

  it('generates unique slugs for the same query', () => {
    const slug1 = generateSlug('same query');
    const slug2 = generateSlug('same query');
    expect(slug1).not.toBe(slug2);
  });
});
