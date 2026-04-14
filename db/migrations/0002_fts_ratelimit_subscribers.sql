-- FTS5 full-text search on research queries
CREATE VIRTUAL TABLE IF NOT EXISTS research_fts USING fts5(
  query,
  category,
  content='research',
  content_rowid='rowid'
);

-- Populate FTS from existing data
INSERT INTO research_fts(rowid, query, category)
  SELECT rowid, query, COALESCE(category, '') FROM research WHERE status = 'complete';

-- Triggers to keep FTS in sync
CREATE TRIGGER research_fts_insert AFTER INSERT ON research
  WHEN NEW.status = 'complete'
BEGIN
  INSERT INTO research_fts(rowid, query, category) VALUES (NEW.rowid, NEW.query, COALESCE(NEW.category, ''));
END;

CREATE TRIGGER research_fts_update AFTER UPDATE OF status ON research
  WHEN NEW.status = 'complete' AND OLD.status != 'complete'
BEGIN
  INSERT INTO research_fts(rowid, query, category) VALUES (NEW.rowid, NEW.query, COALESCE(NEW.category, ''));
END;

CREATE TRIGGER research_fts_delete BEFORE DELETE ON research
BEGIN
  INSERT INTO research_fts(research_fts, rowid, query, category) VALUES ('delete', OLD.rowid, OLD.query, COALESCE(OLD.category, ''));
END;

-- Rate limiting per IP
CREATE TABLE IF NOT EXISTS rate_limits (
  ip TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (ip, endpoint, window_start)
);

CREATE INDEX idx_rate_limits_cleanup ON rate_limits(window_start);

-- Email subscribers for research notifications
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  research_id TEXT NOT NULL REFERENCES research(id),
  created_at INTEGER NOT NULL,
  notified_at INTEGER
);

CREATE INDEX idx_subscribers_research ON subscribers(research_id);
CREATE UNIQUE INDEX idx_subscribers_unique ON subscribers(email, research_id);
