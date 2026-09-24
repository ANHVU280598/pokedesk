# Catalog Desk

Local operator tool for pulling Amazon search results—aimed at Pokemon products—into a SQLite ledger you can browse on this machine. It is not a shopper-facing app.

Paste an Amazon results URL or a Pokemon keyword. A background worker opens the page in Playwright, reads the product cards, and follows **Next** or **Show more** until the list ends or your page cap. If Amazon soft-blocks the session or caps pagination, the job is marked `blocked` and every card already stored is kept. The scraper does not try to evade bot checks.

## Requirements

- Python 3.11+
- Node.js 20+
- Playwright’s Chromium (installed below)

## Install

From the repo root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
playwright install chromium
cd frontend && npm install && cd ..
```

On Linux, Chromium may also need system libraries:

```bash
playwright install-deps chromium
```

## Run the API

```bash
source .venv/bin/activate
uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8765
```

The API listens on [http://127.0.0.1:8765](http://127.0.0.1:8765). Interactive docs are at [http://127.0.0.1:8765/docs](http://127.0.0.1:8765/docs).

The worker runs inside this process. Restarting the API marks an in-flight `running` job as `failed` and keeps the rows it already wrote. A `paused` job stays paused; Resume continues it.

## Run the UI

In a second terminal:

```bash
cd frontend
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123). The dev server proxies `/api` to port 8765.

The UI opens on **New scrape** when nothing is queued or running, and switches to **Live job** when a scrape starts.

## Run a scrape

In the UI:

1. Choose **Amazon URL** or **Pokemon search** (keyword presets, department, optional price band).
2. Set max pages and the delay between pages.
3. **Start scrape**. Pause, stop, and—if Amazon blocks the session—**Wait & retry** or **Stop & keep** are on Live job.
4. Open **Results** (table or grid; a row opens the card drawer) or **History** (View / Re-run).

**Dry-run** uses saved HTML instead of Amazon, which is useful when the live site is flaky:

- UI: **Dry-run with sample HTML** on New scrape.
- API:

```bash
curl -s -X POST http://127.0.0.1:8765/api/jobs \
  -H 'content-type: application/json' \
  -d '{"mode":"fixture","fixture_set":"pokemon","max_pages":5,"delay_sec":0}'
```

A real search:

```bash
curl -s -X POST http://127.0.0.1:8765/api/jobs \
  -H 'content-type: application/json' \
  -d '{"mode":"search","search_query":"pokemon booster box","search_terms":"pokemon cards|booster box","max_pages":2,"delay_sec":2}'
```

Live Amazon scrapes require a delay of at least 1 second and at most 20 pages. Defaults live in **Settings** (delay, max pages, headless or headed). Headed mode needs a display.

Data files (gitignored):

- `data/scrape.db` — jobs, products, observations, page snapshots
- `data/settings.json` — operator defaults

Delete `data/scrape.db` to reset the ledger.

## Tests

```bash
source .venv/bin/activate
pytest
```

Parser tests read HTML fixtures in `backend/app/fixtures/`. Database tests cover ASIN upserts, one observation per job and product, and null ASINs. API tests run fixture jobs through the worker, including pause, stop, soft-block, and page-cap.

## Schema

SQLite tables: `scrape_jobs`, `products`, `scrape_observations`, `page_snapshots`. See `backend/app/schema.sql`.

MVP choices baked in:

- One observation per `(job_id, product_id)`, upserted when the same card appears again in that job.
- No `daily_prices` rollup. Price history is the observation rows across jobs.
- `search_terms` is TEXT on `scrape_jobs` (pipe-separated tags such as `pokemon cards|booster box`).
- Job status adds `blocked` alongside `queued`, `running`, `paused`, `completed`, and `failed`.
- Products are unique on ASIN when ASIN is present. Cards without an ASIN stay separate unless they share a product URL.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/jobs` | Create a URL, search, or fixture job |
| GET | `/api/jobs` | List jobs, newest first |
| GET | `/api/jobs/{id}` | Job status and progress |
| POST | `/api/jobs/{id}/pause` | Pause a running job |
| POST | `/api/jobs/{id}/resume` | Resume a paused job |
| POST | `/api/jobs/{id}/stop` | Stop and keep results, or acknowledge a block |
| POST | `/api/jobs/{id}/retry` | Wait, then retry a blocked job |
| GET | `/api/jobs/{id}/observations` | Cards for a job (`q`, `min_price`, `max_price`, `min_rating`, `sort`) |
| GET | `/api/products/{id}` | Product plus recent observations |
| GET/PUT | `/api/settings` | Default delay, max pages, headless |

## Layout

```
backend/app/          FastAPI app, schema, worker
backend/app/scraper/  HTML parser, URL builder, Playwright + fixture sessions
backend/app/fixtures/ Saved Amazon-like HTML for dry-runs
backend/tests/        Parser, upsert, and API tests
frontend/             React + Vite operator UI
data/                 SQLite database and settings (created at runtime)
```
