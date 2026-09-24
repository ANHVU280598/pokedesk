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
  updated_at TEXT NOT NULL
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
  badges_json TEXT,
  availability_snippet TEXT,
  seller TEXT,
  raw_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  page_number INTEGER,
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
