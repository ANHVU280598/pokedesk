CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  error TEXT,
  tokens INTEGER NOT NULL DEFAULT 0,
  model TEXT
);

CREATE TABLE IF NOT EXISTS run_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  run_id TEXT,
  until_ts INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO run_lock (id, run_id, until_ts) VALUES (1, NULL, 0);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  employee TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  full_text TEXT NOT NULL,
  station TEXT NOT NULL,
  status TEXT NOT NULL,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS events_run_ts ON events (run_id, ts, id);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  preheader TEXT NOT NULL,
  body TEXT NOT NULL,
  footer TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  affiliates_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS issues_created ON issues (created_at DESC);

CREATE TABLE IF NOT EXISTS token_days (
  day TEXT PRIMARY KEY,
  tokens INTEGER NOT NULL
);
