CREATE TABLE IF NOT EXISTS fragments (
  slug TEXT PRIMARY KEY,
  canonical_order INTEGER NOT NULL,
  path TEXT NOT NULL,
  chapter_label TEXT NOT NULL,
  title TEXT NOT NULL,
  title_normalized TEXT NOT NULL,
  preview_text TEXT NOT NULL,
  preview_normalized TEXT NOT NULL,
  body_text TEXT NOT NULL,
  search_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS highlights (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  anon_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (slug) REFERENCES fragments (slug)
);

CREATE INDEX IF NOT EXISTS highlights_by_slug_created_at
  ON highlights (slug, created_at DESC);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  start_offset INTEGER,
  end_offset INTEGER,
  body TEXT NOT NULL,
  anon_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (slug) REFERENCES fragments (slug)
);

CREATE INDEX IF NOT EXISTS comments_by_slug_status_created_at
  ON comments (slug, status, created_at DESC);

CREATE TABLE IF NOT EXISTS request_limits (
  rate_key TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (rate_key, bucket)
);

CREATE INDEX IF NOT EXISTS request_limits_expires_at
  ON request_limits (expires_at);
