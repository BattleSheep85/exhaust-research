-- Canonical query form for semantic clustering.
-- Computed in app code (normalized tokens, sorted) and stored for fast lookup.
-- When a new query has a matching canonical with status=complete, we serve the
-- existing research instead of running a fresh ~20s pipeline.
ALTER TABLE research ADD COLUMN canonical_query TEXT;
CREATE INDEX IF NOT EXISTS idx_research_canonical ON research(canonical_query, status, created_at);
