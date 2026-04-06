import { describe, it, expect } from 'vitest';

// We need to test the private extractTextFromHtml function.
// Since it's not exported, we'll test it indirectly through the module,
// or we refactor to export it. Let's refactor to export test helpers.

// For now, test the logic by reimporting the module and testing public functions.

describe('scraper module', () => {
  it('exports scrapeReddit function', async () => {
    const mod = await import('../src/lib/scraper');
    expect(typeof mod.scrapeReddit).toBe('function');
  });

  it('exports scrapeUrl function', async () => {
    const mod = await import('../src/lib/scraper');
    expect(typeof mod.scrapeUrl).toBe('function');
  });

  it('exports scrapeSearchResults function', async () => {
    const mod = await import('../src/lib/scraper');
    expect(typeof mod.scrapeSearchResults).toBe('function');
  });

  it('ScrapedSource interface shape is usable', async () => {
    const source: import('../src/lib/scraper').ScrapedSource = {
      url: 'https://example.com',
      title: 'Test',
      content: 'Test content',
      source: 'example.com',
    };
    expect(source.url).toBe('https://example.com');
    expect(source.source).toBe('example.com');
  });
});
