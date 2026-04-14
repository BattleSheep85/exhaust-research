-- Quick-answer preview text generated in parallel with the full research run.
-- Shown on the processing page while the 20s scrape pipeline completes, so the
-- user sees a useful answer within ~3s instead of a pure progress spinner.
ALTER TABLE research ADD COLUMN preview TEXT;
