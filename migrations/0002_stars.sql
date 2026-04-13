CREATE TABLE IF NOT EXISTS stars (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  anon_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (slug) REFERENCES fragments (slug),
  UNIQUE (slug, visitor_hash)
);

CREATE INDEX IF NOT EXISTS stars_by_slug_created_at
  ON stars (slug, created_at DESC);
