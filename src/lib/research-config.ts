import type { Tier, ResearchConfig } from '../types';

export const TIER_CONFIGS: Record<Tier, ResearchConfig> = {
  instant: {
    maxToolCalls: 12,
    maxSearches: 8,
    maxFetches: 0,
    timeoutMs: 30_000,
    synthModel: 'google/gemini-2.5-flash',
    plannerModel: 'google/gemini-2.5-flash',
    reportSections: ['summary', 'products', 'methodology'],
    requireTurnstile: false,
    requireSubscription: false,
  },
  full: {
    maxToolCalls: 18,
    maxSearches: 12,
    maxFetches: 3,
    timeoutMs: 25_000,
    synthModel: 'google/gemini-2.5-flash',
    plannerModel: 'google/gemini-2.5-flash',
    reportSections: ['summary', 'products', 'comparison', 'methodology'],
    requireTurnstile: false,
    requireSubscription: false,
  },
  exhaustive: {
    maxToolCalls: 100,
    maxSearches: 60,
    maxFetches: 40,
    timeoutMs: 300_000,
    synthModel: 'google/gemini-2.5-flash',
    plannerModel: 'google/gemini-2.5-flash',
    reportSections: ['summary', 'products', 'comparison', 'categories', 'pitfalls', 'buyerGuide', 'methodology'],
    requireTurnstile: true,
    requireSubscription: false,
  },
  unbound: {
    maxToolCalls: 250,
    maxSearches: 150,
    maxFetches: 100,
    timeoutMs: 1_800_000,
    synthModel: 'google/gemini-2.5-flash',
    plannerModel: 'google/gemini-2.5-flash',
    reportSections: ['summary', 'products', 'comparison', 'categories', 'pitfalls', 'buyerGuide', 'methodology'],
    requireTurnstile: true,
    requireSubscription: true,
  },
};

export function getTierConfig(tier: Tier): ResearchConfig {
  return TIER_CONFIGS[tier];
}

export function isValidTier(value: string): value is Tier {
  return value === 'instant' || value === 'full' || value === 'exhaustive' || value === 'unbound';
}
