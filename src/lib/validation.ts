import { z } from 'zod';

const HttpsUrlSchema = z.string().refine(
  (url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  },
  { message: 'Must be a valid HTTP(S) URL' },
);

const ProductResultSchema = z.object({
  name: z.string().min(1).max(500),
  brand: z.string().max(200).default(''),
  price: z.number().nullable().default(null),
  rating: z.number().min(0).max(5).nullable().default(null),
  imageUrl: z.string().nullable().default(null),
  productUrl: z.string().default(''),
  affiliateUrl: z.string().default(''),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  specs: z.record(z.string(), z.string()).default({}),
  verdict: z.string().max(1000).default(''),
  rank: z.number().int().min(1).default(1),
  bestFor: z.string().max(100).default(''),
});

export const ResearchResultSchema = z.object({
  summary: z.string().min(1).max(2000),
  category: z.string().min(1).max(100),
  products: z.array(ProductResultSchema).min(0).max(20),
  methodology: z.string().max(2000).default(''),
  lastUpdated: z.string().optional(),
});

export type ValidatedResearchResult = z.infer<typeof ResearchResultSchema>;
export type ValidatedProductResult = z.infer<typeof ProductResultSchema>;

export function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function sanitizeUrl(url: string): string {
  return isValidHttpUrl(url) ? url : '';
}

export function escapeLikeWildcards(input: string): string {
  return input.replace(/%/g, '\\%').replace(/_/g, '\\_');
}
