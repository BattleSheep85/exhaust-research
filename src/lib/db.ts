import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../../db/schema';

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function generateSlug(query: string): string {
  const base = slugify(query);
  const suffix = generateId().slice(0, 8);
  return `${base}-${suffix}`;
}
