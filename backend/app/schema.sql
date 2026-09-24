-- Local scrape ledger. Portable SQL aside from the partial ASIN index.
-- MVP: one observation per (job_id, product_id), no daily_prices rollup,
-- search_terms as TEXT, and status `blocked` for Amazon soft-blocks / page caps.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS scrape_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_url TEXT,
  search_query TEXT,
  search_terms TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','running','paused','completed','failed','blocked')),
  pagination_mode TEXT NOT NULL DEFAULT 'unknown'
    CHECK (pagination_mode IN ('next_page','show_more','unknown')),
  pages_visited INTEGER NOT NULL DEFAULT 0,
  items_scraped INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  error_message TEXT,
  settings_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  parent_job_id INTEGER REFERENCES scrape_jobs(id) ON DELETE SET NULL,
  queue_at TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asin TEXT,
  title TEXT NOT NULL,
  image_url TEXT,
  product_url TEXT,
  category_breadcrumbs TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_products_asin ON products(asin) WHERE asin IS NOT NULL;

CREATE TABLE IF NOT EXISTS scrape_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES scrape_jobs(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price REAL,
  currency TEXT,
  list_price REAL,
  rating REAL,
  review_count INTEGER,
  bought_past_month INTEGER,
  bought_past_month_text TEXT,
  badges_json TEXT,
  availability_snippet TEXT,
  seller TEXT,
  raw_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  page_number INTEGER,
  source TEXT NOT NULL DEFAULT 'results',
  UNIQUE (job_id, product_id)
);

CREATE INDEX IF NOT EXISTS ix_jobs_status ON scrape_jobs(status);
CREATE INDEX IF NOT EXISTS ix_jobs_created_at ON scrape_jobs(created_at);
CREATE INDEX IF NOT EXISTS ix_obs_job_id ON scrape_observations(job_id);
CREATE INDEX IF NOT EXISTS ix_obs_product_id ON scrape_observations(product_id);
CREATE INDEX IF NOT EXISTS ix_obs_product_observed ON scrape_observations(product_id, observed_at);

CREATE TABLE IF NOT EXISTS page_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES scrape_jobs(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  url TEXT NOT NULL,
  items_found INTEGER NOT NULL DEFAULT 0,
  scraped_at TEXT NOT NULL,
  UNIQUE (job_id, page_number)
);

CREATE INDEX IF NOT EXISTS ix_snapshots_job ON page_snapshots(job_id);

CREATE TABLE IF NOT EXISTS tcgplayer_matches (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES scrape_jobs(id) ON DELETE SET NULL,
  query TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('matched', 'needs_confirm', 'unmatched', 'error')),
  tcg_url TEXT,
  tcg_name TEXT,
  tcg_set TEXT,
  image_url TEXT,
  price REAL,
  price_label TEXT,
  currency TEXT,
  confidence REAL,
  raw_json TEXT,
  matched_at TEXT NOT NULL,
  match_source TEXT,
  error_text TEXT
);

CREATE INDEX IF NOT EXISTS ix_tcg_job ON tcgplayer_matches(job_id);

CREATE TABLE IF NOT EXISTS tcgplayer_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  set_name TEXT,
  url TEXT NOT NULL,
  image_url TEXT,
  price REAL,
  price_label TEXT,
  currency TEXT,
  prices_json TEXT,
  confidence REAL NOT NULL,
  position INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_tcg_candidates_product ON tcgplayer_candidates(product_id);

CREATE TABLE IF NOT EXISTS tcgplayer_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tcg_url TEXT NOT NULL,
  tcg_product_id TEXT,
  price REAL,
  price_label TEXT,
  currency TEXT,
  prices_json TEXT,
  scraped_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_tcg_price_history_product
  ON tcgplayer_price_history(product_id, scraped_at);
