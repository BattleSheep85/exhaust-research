CREATE TABLE IF NOT EXISTS research (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  query TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'complete', 'failed')),
  category TEXT,
  summary TEXT,
  result TEXT,
  sources TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  view_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  research_id TEXT NOT NULL REFERENCES research(id),
  name TEXT NOT NULL,
  brand TEXT,
  price REAL,
  currency TEXT DEFAULT 'USD',
  rating REAL,
  image_url TEXT,
  product_url TEXT,
  affiliate_url TEXT,
  pros TEXT,
  cons TEXT,
  specs TEXT,
  verdict TEXT,
  rank INTEGER,
  best_for TEXT
);

CREATE INDEX idx_research_slug ON research(slug);
CREATE INDEX idx_research_status ON research(status);
CREATE INDEX idx_research_created ON research(created_at DESC);
CREATE INDEX idx_products_research ON products(research_id);
