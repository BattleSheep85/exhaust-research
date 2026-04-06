import { describe, it, expect } from 'vitest';
import { ResearchResultSchema, isValidHttpUrl, sanitizeUrl, escapeLikeWildcards } from '../src/lib/validation';

describe('isValidHttpUrl', () => {
  it('accepts https URLs', () => {
    expect(isValidHttpUrl('https://example.com')).toBe(true);
  });

  it('accepts http URLs', () => {
    expect(isValidHttpUrl('http://example.com')).toBe(true);
  });

  it('rejects javascript: URLs', () => {
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects data: URLs', () => {
    expect(isValidHttpUrl('data:text/html,<h1>hi</h1>')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidHttpUrl('')).toBe(false);
  });

  it('rejects non-URL strings', () => {
    expect(isValidHttpUrl('not a url')).toBe(false);
  });
});

describe('sanitizeUrl', () => {
  it('returns valid URLs unchanged', () => {
    expect(sanitizeUrl('https://amazon.com/dp/123')).toBe('https://amazon.com/dp/123');
  });

  it('returns empty string for invalid URLs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeUrl('')).toBe('');
  });
});

describe('escapeLikeWildcards', () => {
  it('escapes percent signs', () => {
    expect(escapeLikeWildcards('100%')).toBe('100\\%');
  });

  it('escapes underscores', () => {
    expect(escapeLikeWildcards('hello_world')).toBe('hello\\_world');
  });

  it('leaves normal text unchanged', () => {
    expect(escapeLikeWildcards('best NAS under 500')).toBe('best NAS under 500');
  });

  it('escapes multiple wildcards', () => {
    expect(escapeLikeWildcards('%_%')).toBe('\\%\\_\\%');
  });
});

describe('ResearchResultSchema', () => {
  it('validates a well-formed research result', () => {
    const input = {
      summary: 'Test summary',
      category: 'NAS',
      products: [
        {
          name: 'Product 1',
          brand: 'Brand A',
          price: 299.99,
          rating: 4.5,
          imageUrl: null,
          productUrl: 'https://example.com',
          affiliateUrl: '',
          pros: ['Good'],
          cons: ['Bad'],
          specs: { storage: '4TB' },
          verdict: 'Solid pick',
          rank: 1,
          bestFor: 'budget',
        },
      ],
      methodology: 'Analyzed 5 sources',
    };

    const result = ResearchResultSchema.parse(input);
    expect(result.summary).toBe('Test summary');
    expect(result.products).toHaveLength(1);
    expect(result.products[0].name).toBe('Product 1');
  });

  it('rejects missing required fields', () => {
    expect(() => ResearchResultSchema.parse({})).toThrow();
    expect(() => ResearchResultSchema.parse({ summary: 'hi' })).toThrow();
  });

  it('applies defaults for optional fields', () => {
    const input = {
      summary: 'Test',
      category: 'Monitors',
      products: [{ name: 'Monitor X', rank: 1 }],
    };

    const result = ResearchResultSchema.parse(input);
    expect(result.products[0].pros).toEqual([]);
    expect(result.products[0].cons).toEqual([]);
    expect(result.products[0].price).toBeNull();
    expect(result.products[0].specs).toEqual({});
  });

  it('rejects products with empty name', () => {
    const input = {
      summary: 'Test',
      category: 'Monitors',
      products: [{ name: '', rank: 1 }],
    };

    expect(() => ResearchResultSchema.parse(input)).toThrow();
  });

  it('caps ratings at 5', () => {
    const input = {
      summary: 'Test',
      category: 'Monitors',
      products: [{ name: 'X', rank: 1, rating: 10 }],
    };

    expect(() => ResearchResultSchema.parse(input)).toThrow();
  });
});
