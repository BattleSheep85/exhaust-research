-- Add tier column to research table
ALTER TABLE research ADD COLUMN tier TEXT NOT NULL DEFAULT 'instant';

-- Activity feed: tracks each step of the research process for live UI
CREATE TABLE IF NOT EXISTS research_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  research_id TEXT NOT NULL REFERENCES research(id),
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_events_research_seq ON research_events(research_id, seq);
