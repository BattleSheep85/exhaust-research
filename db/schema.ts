import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const research = sqliteTable('research', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  query: text('query').notNull(),
  status: text('status', { enum: ['pending', 'processing', 'complete', 'failed'] }).notNull().default('pending'),
  category: text('category'),
  summary: text('summary'),
  result: text('result'), // Full JSON result from Claude
  sources: text('sources'), // JSON array of scraped source URLs
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  viewCount: integer('view_count').notNull().default(0),
});

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  researchId: text('research_id').notNull().references(() => research.id),
  name: text('name').notNull(),
  brand: text('brand'),
  price: real('price'),
  currency: text('currency').default('USD'),
  rating: real('rating'),
  imageUrl: text('image_url'),
  productUrl: text('product_url'),
  affiliateUrl: text('affiliate_url'),
  pros: text('pros'), // JSON array
  cons: text('cons'), // JSON array
  specs: text('specs'), // JSON object
  verdict: text('verdict'),
  rank: integer('rank'),
  bestFor: text('best_for'), // e.g. "budget", "performance", "value"
});

export type Research = typeof research.$inferSelect;
export type NewResearch = typeof research.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
