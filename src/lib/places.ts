import type { ScrapedSource } from '../types';

// Google Places API (New) — Text Search endpoint.
// https://developers.google.com/maps/documentation/places/web-service/text-search
//
// Cost: ~$0.017 per text search on the standard tier (first 1000/month free under
// the $200 monthly credit). FieldMask keeps billed tier to "Text Search (ID Only)"
// plus "Basic" fields — dramatically cheaper than including Atmosphere or Contact.

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = [
  'places.displayName',
  'places.formattedAddress',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.regularOpeningHours.weekdayDescriptions',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.types',
  'places.editorialSummary',
].join(',');

interface PlacesRawResponse {
  places?: Array<{
    displayName?: { text?: string };
    formattedAddress?: string;
    rating?: number;
    userRatingCount?: number;
    priceLevel?: string;
    regularOpeningHours?: { weekdayDescriptions?: string[] };
    nationalPhoneNumber?: string;
    websiteUri?: string;
    googleMapsUri?: string;
    types?: string[];
    editorialSummary?: { text?: string };
  }>;
}

function formatPriceLevel(level: string | undefined): string | undefined {
  switch (level) {
    case 'PRICE_LEVEL_FREE': return 'Free';
    case 'PRICE_LEVEL_INEXPENSIVE': return '$';
    case 'PRICE_LEVEL_MODERATE': return '$$';
    case 'PRICE_LEVEL_EXPENSIVE': return '$$$';
    case 'PRICE_LEVEL_VERY_EXPENSIVE': return '$$$$';
    default: return undefined;
  }
}

export interface PlaceResult {
  name: string;
  address: string;
  rating?: number;
  ratingCount?: number;
  priceLevel?: string;
  hours?: string;
  phone?: string;
  websiteUrl?: string;
  mapsUrl?: string;
  types?: string[];
  summary?: string;
}

// Returns structured place results. Caller is expected to convert into
// ScrapedSource-like notes so the agent/synthesis treats them like any other source.
export async function placesTextSearch(query: string, apiKey: string, limit = 10): Promise<PlaceResult[]> {
  try {
    const response = await fetch(PLACES_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: query, pageSize: Math.min(limit, 20) }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.log(`[places] HTTP ${response.status}: ${text.slice(0, 200)}`);
      return [];
    }
    const data: PlacesRawResponse = await response.json();
    const places = data.places ?? [];
    const results: PlaceResult[] = [];
    for (const p of places.slice(0, limit)) {
      const name = p.displayName?.text?.trim();
      if (!name) continue;
      results.push({
        name,
        address: p.formattedAddress ?? '',
        rating: typeof p.rating === 'number' ? p.rating : undefined,
        ratingCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : undefined,
        priceLevel: formatPriceLevel(p.priceLevel),
        hours: p.regularOpeningHours?.weekdayDescriptions?.join('; '),
        phone: p.nationalPhoneNumber,
        websiteUrl: p.websiteUri,
        mapsUrl: p.googleMapsUri,
        types: p.types,
        summary: p.editorialSummary?.text,
      });
    }
    console.log(`[places] q="${query}" → ${results.length} places`);
    return results;
  } catch (err) {
    console.log(`[places] ERROR q="${query}": ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// Convert PlaceResult[] into ScrapedSource entries so the synthesis LLM sees them
// alongside web sources. Title carries the place name + address; content carries
// the structured facts in a deterministic, parse-friendly layout.
export function placesToScrapedSources(results: PlaceResult[]): ScrapedSource[] {
  return results.map((r) => {
    const lines: string[] = [r.name];
    if (r.address) lines.push(`Address: ${r.address}`);
    if (r.phone) lines.push(`Phone: ${r.phone}`);
    if (r.hours) lines.push(`Hours: ${r.hours}`);
    if (r.priceLevel) lines.push(`Price: ${r.priceLevel}`);
    if (r.rating != null) lines.push(`Rating: ${r.rating} (${r.ratingCount ?? '?'} reviews)`);
    if (r.types && r.types.length > 0) lines.push(`Types: ${r.types.slice(0, 5).join(', ')}`);
    if (r.summary) lines.push(`Summary: ${r.summary}`);
    if (r.websiteUrl) lines.push(`Website: ${r.websiteUrl}`);
    if (r.mapsUrl) lines.push(`Maps: ${r.mapsUrl}`);
    return {
      url: r.mapsUrl ?? r.websiteUrl ?? '',
      title: `${r.name}${r.address ? ` — ${r.address}` : ''}`,
      content: lines.join('\n'),
      source: 'places',
    };
  });
}
