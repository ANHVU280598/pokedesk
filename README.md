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
3. **Start scrape**. Pause, stop, and—if Amazon blocks the session—**Wait & retry**, **Stop & keep**, or **Create follow-up jobs** are on Live job.
4. Open **Results** (table or grid; a row opens the card drawer), **History** (View / Re-run / follow-ups on blocked jobs), or **Database** (edit, delete, and merge products).

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

Live Amazon scrapes require a delay of at least 1 second and at most 20 pages. Defaults live in **Settings** (delay, max pages, headless or headed, optional proxy). Headed mode needs a display.

## Follow-up jobs

When a job ends as `blocked`, Live job and History offer **Create follow-up jobs**. Suggestions slice the original search by price (under $25, $25–$50, $50–$100, $100+), by an Amazon sort (featured, price low to high, newest), or — for a Pokemon search — by a narrower keyword such as booster box, tin, or Charizard. Each selected suggestion becomes a new `scrape_job` with `parent_job_id` set and `search_terms` noting the follow-up. They do not continue pagination on the blocked URL, and they do not try to evade the check.

A blocked dry-run still suggests live Amazon searches built from that job’s keyword.

**Recheck for more pages** puts the blocked job back in the queue. It opens the next results page when that URL can be built from the page it stopped on (including the next saved fixture page). Otherwise it reloads the same results list and looks again for a next page or Show more. The job then says whether more pages were scraped or the list is still capped. Stored cards are kept either way. If it is still capped, run another round of slices.

Queuing follow-ups marks the parent for that same recheck, which runs after the follow-ups finish. **Wait & retry** is still the short pause-and-reload for a robot check. Recheck does not click products, scroll, or pretend to browse.

## Blocked recovery pattern

New scrape and Settings can turn on a pattern that runs only after the primary crawl is blocked:

1. **Primary crawl** reads the start URL or search, up to `max_pages`, and keeps the page where the job became blocked.
2. **Related-item expansion** (optional) goes back to the earliest stored result cards from this job and opens up to N of them (`related_cards_limit`, 1–20). On each product page it stores related, similar, sponsored, or “customers also viewed” cards when that layout is present, tagged `source=related` on the observation. Missing carousels are skipped. The same delay applies, and pause or stop still works between cards. This collects more catalog rows. It does not scroll, move the mouse, or click around to unlock the next results page.
3. **Recheck** (on by default) then runs the existing recheck on the blocked list: continue to the next page when that URL can be built, otherwise reload the same results list. The job reports whether more pages were scraped or the list is still capped. Stored cards, including related ones, stay either way.
4. If it is still blocked, the soft-block banner and **Create follow-up jobs** stay available.

Related expansion gathers more products. Recheck probes pagination again. Neither step guarantees Amazon will open more pages.

## Proxy

Settings can turn on a proxy (`http`, `https`, or `socks5`) with an optional username and password. New scrape can use that default, turn the proxy off for one job, or set a custom URL. Playwright receives the proxy only for live scrapes. Fixture dry-runs never use it.

The password is stored in plaintext in `data/settings.json` (gitignored) and copied into the job row so a restart can still launch that scrape. The API returns an empty password plus `proxy_password_set`. Leave the password field blank to keep the saved one, or check **Clear saved password**.

## Products and duplicates

- A product with an ASIN is one row. Seeing that ASIN again updates the row. Each job keeps its own observation, so price history is those rows, not a second product.
- The same ASIN twice in one job updates that job’s single observation.
- Cards with no ASIN are not collapsed together, except when they share a product URL.
- While scraping, if a new card has an ASIN and exactly one existing no-ASIN card matches its product URL—or, failing that, its normalized title is at least 12 characters and matches exactly one no-ASIN row—the ASIN is written onto that row. Several title matches are left alone.
- **Database** can search products, filter by ASIN and last-seen dates, edit a row, delete a snapshot, and delete a finished job (its snapshots go with it; products stay). Deleting a product that still has snapshots is refused unless you confirm, which removes those snapshots.
- **Duplicates** lists same-title groups and no-ASIN cards that sit next to an ASIN match. **Merge** keeps one row, moves snapshots onto it, and drops the other. If both rows have observations for the same job, the later snapshot is kept.

Data files (gitignored):

- `data/scrape.db` — jobs, products, observations, page snapshots
- `data/settings.json` — operator defaults, including the proxy password

Delete `data/scrape.db` to reset the ledger. Delete `data/settings.json` to reset defaults.

## Tests

```bash
source .venv/bin/activate
pytest
```

Parser tests read HTML fixtures in `backend/app/fixtures/`. Database tests cover ASIN upserts, one observation per job and product, null ASINs, and attaching an ASIN onto one matching no-ASIN row. API tests run fixture jobs through the worker, including pause, stop, soft-block, page-cap, follow-ups from a blocked parent, proxy settings, product edit, merge, and the blocked recovery pattern (settings, related expansion then recheck, the card limit, and pause or stop during expansion). Live browser launch is disabled in those tests.

## Schema

SQLite tables: `scrape_jobs`, `products`, `scrape_observations`, `page_snapshots`. See `backend/app/schema.sql`.

MVP choices baked in:

- One observation per `(job_id, product_id)`, upserted when the same card appears again in that job.
- No `daily_prices` rollup. Price history is the observation rows across jobs.
- `search_terms` is TEXT on `scrape_jobs` (pipe-separated tags such as `pokemon cards|booster box`).
- Job status adds `blocked` alongside `queued`, `running`, `paused`, `completed`, and `failed`.
- Products are unique on ASIN when ASIN is present. Cards without an ASIN stay separate unless they share a product URL, or a later card with an ASIN matches one of them (see above).
- `scrape_jobs.parent_job_id` points at the blocked job a follow-up was created from. Deleting the parent clears the link.
- `scrape_observations.source` is `results` or `related`. A related card does not replace that job’s results snapshot for the same product.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/jobs` | Create a URL, search, or fixture job |
| GET | `/api/jobs` | List jobs, newest first |
| GET | `/api/jobs/{id}` | Job status and progress |
| POST | `/api/jobs/{id}/pause` | Pause a running job |
| POST | `/api/jobs/{id}/resume` | Resume a paused job |
| POST | `/api/jobs/{id}/stop` | Stop and keep results, or acknowledge a block |
| POST | `/api/jobs/{id}/retry` | Wait, then retry a blocked job on the same page |
| POST | `/api/jobs/{id}/recheck` | Continue to the next page, or reload the results list (`mode`: `continue` or `reload`) |
| GET | `/api/jobs/{id}/follow-ups` | Suggested price and sort slices for a blocked job |
| POST | `/api/jobs/{id}/follow-ups` | Queue selected follow-ups (`suggestion_ids`) |
| DELETE | `/api/jobs/{id}` | Delete a finished job, its observations, and its snapshots |
| GET | `/api/jobs/{id}/observations` | Cards for a job (`q`, `min_price`, `max_price`, `min_rating`, `sort`) |
| GET | `/api/products` | Search the catalog (`q`, `has_asin`, `last_seen_after`, `last_seen_before`, `limit`, `offset`) |
| GET | `/api/products/duplicates` | Same-title and no-ASIN hints |
| POST | `/api/products/merge` | Merge `drop_id` into `keep_id` and reassign observations |
| GET | `/api/products/{id}` | Product plus recent observations |
| PATCH | `/api/products/{id}` | Edit title, ASIN, image, URL, breadcrumbs |
| DELETE | `/api/products/{id}` | Delete a product. `force=true` also deletes its observations |
| DELETE | `/api/observations/{id}` | Delete one snapshot and recount the job |
| GET/PUT | `/api/settings` | Delay, max pages, headless, and proxy. GET masks the password |

## Layout

```
backend/app/          FastAPI app, schema, worker
backend/app/scraper/  HTML parser, URL builder, Playwright + fixture sessions
backend/app/fixtures/ Saved Amazon-like HTML for dry-runs
backend/tests/        Parser, upsert, and API tests
frontend/             React + Vite operator UI
data/                 SQLite database and settings (created at runtime)
```
