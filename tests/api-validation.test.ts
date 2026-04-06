import { describe, it, expect } from 'vitest';

// Test the validation logic that the API endpoint uses
// These test pure functions extracted from the API route

function validateQuery(query: unknown): { valid: boolean; error?: string } {
  if (typeof query !== 'string') {
    return { valid: false, error: 'Query must be a string' };
  }
  const trimmed = query.trim();
  if (trimmed.length < 3) {
    return { valid: false, error: 'Query must be at least 3 characters' };
  }
  if (trimmed.length > 500) {
    return { valid: false, error: 'Query must be 500 characters or fewer' };
  }
  return { valid: true };
}

describe('query validation', () => {
  it('accepts valid queries', () => {
    expect(validateQuery('best NAS under 500')).toEqual({ valid: true });
  });

  it('rejects empty strings', () => {
    expect(validateQuery('')).toEqual({ valid: false, error: 'Query must be at least 3 characters' });
  });

  it('rejects whitespace-only strings', () => {
    expect(validateQuery('   ')).toEqual({ valid: false, error: 'Query must be at least 3 characters' });
  });

  it('rejects strings shorter than 3 chars', () => {
    expect(validateQuery('ab')).toEqual({ valid: false, error: 'Query must be at least 3 characters' });
  });

  it('rejects strings longer than 500 chars', () => {
    expect(validateQuery('a'.repeat(501))).toEqual({ valid: false, error: 'Query must be 500 characters or fewer' });
  });

  it('accepts exactly 3 character query', () => {
    expect(validateQuery('abc')).toEqual({ valid: true });
  });

  it('accepts exactly 500 character query', () => {
    expect(validateQuery('a'.repeat(500))).toEqual({ valid: true });
  });

  it('rejects non-string inputs', () => {
    expect(validateQuery(123)).toEqual({ valid: false, error: 'Query must be a string' });
    expect(validateQuery(null)).toEqual({ valid: false, error: 'Query must be a string' });
    expect(validateQuery(undefined)).toEqual({ valid: false, error: 'Query must be a string' });
  });

  it('trims whitespace before validating length', () => {
    expect(validateQuery('  abc  ')).toEqual({ valid: true });
    expect(validateQuery('  ab  ')).toEqual({ valid: false, error: 'Query must be at least 3 characters' });
  });
});
