-- Classifier output + universal item metadata.
-- topical_category: freeform from classifier (e.g. "Italian restaurants", "mechanical keyboards").
-- facets: JSON {is_buyable, needs_location, is_experience, is_content, is_service, is_comparative}
--        persisted for debugging; the live copy rides the queue message.
-- metadata: JSON on products — facet-specific key/value pairs (address, hours, cuisine, etc.)
--           that don't fit the buyable-product columns. Unknown keys render generically.

ALTER TABLE research ADD COLUMN topical_category TEXT;
ALTER TABLE research ADD COLUMN facets TEXT;
ALTER TABLE products ADD COLUMN metadata TEXT;
