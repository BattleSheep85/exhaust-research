import { describe, it, expect } from 'vitest';
import { generateAffiliateUrl } from '../src/lib/researcher';

describe('generateAffiliateUrl', () => {
  it('adds affiliate tag to Amazon URLs', () => {
    const url = generateAffiliateUrl('https://www.amazon.com/dp/B08N5WRWNW', 'test-tag-20');
    expect(url).toContain('tag=test-tag-20');
    expect(url).toContain('amazon.com');
  });

  it('preserves existing query parameters on Amazon URLs', () => {
    const url = generateAffiliateUrl('https://www.amazon.com/dp/B08N5WRWNW?ref=sr_1_1', 'test-tag-20');
    expect(url).toContain('ref=sr_1_1');
    expect(url).toContain('tag=test-tag-20');
  });

  it('returns non-Amazon URLs unchanged', () => {
    const original = 'https://www.bestbuy.com/product/12345';
    const result = generateAffiliateUrl(original, 'test-tag-20');
    expect(result).toBe(original);
  });

  it('handles invalid URLs gracefully', () => {
    const result = generateAffiliateUrl('not-a-url', 'test-tag-20');
    expect(result).toBe('not-a-url');
  });

  it('handles empty string', () => {
    const result = generateAffiliateUrl('', 'test-tag-20');
    expect(result).toBe('');
  });

  it('overwrites existing tag parameter', () => {
    const url = generateAffiliateUrl('https://www.amazon.com/dp/B08N5WRWNW?tag=old-tag', 'new-tag-20');
    expect(url).toContain('tag=new-tag-20');
    expect(url).not.toContain('old-tag');
  });
});
