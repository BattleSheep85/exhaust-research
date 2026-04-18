-- Clarifying answers collected on the interstitial page for Full/Exhaustive
-- tiers. JSON object: {"budget": "$200-500", "household_size": "Large house"}.
-- Nullable — instant tier skips the grill; Full/Exhaustive queries that are
-- already specific emit no questions and leave this null too.
ALTER TABLE research ADD COLUMN clarifications TEXT;
