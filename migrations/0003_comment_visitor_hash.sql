ALTER TABLE comments
  ADD COLUMN visitor_hash TEXT;

CREATE INDEX IF NOT EXISTS comments_by_slug_visitor_status_created_at
  ON comments (slug, visitor_hash, status, created_at DESC);
