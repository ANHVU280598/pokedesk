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

## Start, pull, restart

From the repo root, one menu covers the usual operator steps:

```bash
./scripts/catalog-desk.sh
```

Or run a single action:

```bash
make start      # API on http://127.0.0.1:8765 and UI on http://127.0.0.1:43123
make pull       # git pull --ff-only of the current branch
make restart    # stop both, then start them again
make stop
make push       # git push -u github <current-branch>
```

`make pull` does not restart a running app. After a pull, run `make restart` so the new code is what is serving. `make start` and `make restart` refresh the existing `.venv` from `backend/requirements.txt` before they launch the API, so a pull that adds a Python package does not need a separate `pip install`. Frontend packages are not installed for you: if `frontend/node_modules` is missing, start stops and tells you to run `npm install` in `frontend/`. Start is safe to repeat: if those ports are already open, it leaves them alone and prints the URLs. Logs go in `.catalog-desk/` (gitignored). If the API never answers, start prints the last lines of `.catalog-desk/api.log`.

`make push` uploads the current branch to Anh’s GitHub repo. It uses the `github` remote when that remote already exists (HTTPS or SSH). If `github` is missing, the script adds `https://github.com/ANHVU280598/pokedesk.git`. It does not force-push and it does not pull first. To use SSH instead:

```bash
git remote set-url github git@github.com:ANHVU280598/pokedesk.git
```

If the push is rejected for auth, sign in with a personal access token that has `repo` scope, or run `gh auth login`.

The same commands work on macOS. The script uses the repo’s `.venv` and `frontend/node_modules`, so run the install steps above once first.

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

Live Amazon scrapes require a delay of at least 1 second. Max pages is any whole number from 1 up — there is no 20-page ceiling. A high number does not invent pages: the job still stops when the result list ends or Amazon soft-blocks. Defaults live in **Settings** (delay, max pages, headless or headed, optional proxy). Headed mode needs a display.

## Follow-up jobs

When a job ends as `blocked`, Live job and History offer **Create follow-up jobs**. Suggestions slice the original search by price (under $25, $25–$50, $50–$100, $100+), by an Amazon sort (featured, price low to high, newest), or — for a Pokemon search — by a narrower keyword such as booster box, tin, or Charizard. Each selected suggestion becomes a new `scrape_job` with `parent_job_id` set and `search_terms` noting the follow-up. They do not continue pagination on the blocked URL, and they do not try to evade the check.

A blocked dry-run still suggests live Amazon searches built from that job’s keyword.

**Recheck for more pages** puts the blocked job back in the queue. It opens the next results page when that URL can be built from the page it stopped on (including the next saved fixture page). Otherwise it reloads the same results list and looks again for a next page or Show more. The job then says whether more pages were scraped or the list is still capped. Stored cards are kept either way. If it is still capped, run another round of slices.

Queuing follow-ups marks the parent for that same recheck, which runs after the follow-ups finish. **Wait & retry** is still the short pause-and-reload for a robot check. Recheck does not click products, scroll, or pretend to browse.

## Blocked recovery pattern

New scrape and Settings can turn on a pattern that runs only after the primary crawl is blocked:

1. **Primary crawl** reads the start URL or search, up to `max_pages`, and keeps the page where the job became blocked.
2. **Related-item expansion** (optional), still in that same browser, goes back to **page 1** of this search. For each of N cards (`related_cards_limit`): from that page-1 list, open the i-th product card by clicking its link (if the click does not open a product, load the stored product URL), scrape related / similar / customers-also-viewed cards when that layout is present, store them as `source=related`, then load **page 1** again. It does not jump to the blocked deep page between cards. The same delay applies between steps, and pause or stop still works. Missing carousels are skipped. This collects more catalog rows. It does not scroll or click around to unlock pagination.
3. **Recheck** (on by default) then runs the existing recheck from the blocked pagination point: continue to the next page when that URL can be built, otherwise reload the blocked results list. The job reports whether more pages were scraped or the list is still capped. Stored cards, including related ones, stay either way.
4. If it is still blocked, the soft-block banner and **Create follow-up jobs** stay available.

Related expansion gathers more products. Recheck probes pagination again. Neither step guarantees Amazon will open more pages.

Those steps stay in the one Playwright browser, context, and page opened for the primary crawl. Page 1, each list click, the return to page 1, and the later recheck all use that page, so cookies, storage, and the job proxy carry across. The pattern does not launch a second browser or a new context per card. A Recheck you start later from the banner is a new run, after this browser has closed.

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
- `bought_past_month` and `bought_past_month_text` sit on each observation, like price. They stay empty when the card does not show a “bought in past month” count. Results can sort by that number.
- `tcgplayer_matches` stores one current TCGPlayer lookup per product (URL, name, set, image, price, the raw price label such as Market, confidence, and `matched`, `needs_confirm`, or `unmatched`). It survives later Amazon jobs. Clear or re-run replaces it.
- `tcgplayer_candidates` stores each plausible listing from that lookup (name, set, URL, image, labeled prices). Confirm copies the chosen row onto the match.

## TCGPlayer match

After an Amazon job has products, click **Match on TCGPlayer** on **Results** to start a match for that job’s list. A finished Amazon scrape leaves matching idle until that click. The same button is on Live job. A product row can also be matched from its detail. The click opens **Live job** for the match pass: progress, pause, and stop apply between products, the same way they do between Amazon pages. When the pass finishes, Results shows each product’s listings.

The worker strips “Pokemon”, “TCG”, and pack-count noise from the title, then scores TCGPlayer hits and keeps the price label that the page shows (Market, Low, Mid, or whatever is printed) plus the numeric amount when it parses. Exactly one strong hit is stored as matched, with that price, and the row offers **Compare**. More than one plausible listing is `needs_confirm`: nothing is chosen until **Choose listing** picks a radio option. Confirming that listing marks the product matched and opens **Compare prices**, Amazon on one side and the confirmed TCGPlayer card on the other, with the price gap. A matched row can be changed later from **Change**. An empty search, or a clearly unrelated hit, stays unmatched. No listing is invented.

A dry-run Amazon job matches against saved search HTML, so tests and fixture scrapes do not open TCGPlayer. Products that have only ever been seen in fixture jobs stay on that path. A product from a live Amazon scrape uses Playwright against `tcgplayer.com` Pokemon search. One pass matches up to 500 products. Soft-blocks keep the matches already stored.

## Export

Each list has **Export current list** with **CSV** and **Excel** (.xlsx). The file uses the filters on that screen. Clear the filters to download the whole list. Prices are copied from stored rows; a missing price stays blank.

| List | Where | Filename |
| --- | --- | --- |
| Amazon cards in one job | Results | `amazon-products-job-<id>-YYYYMMDD.csv` (or `.xlsx`) |
| Amazon catalog | Database → Products | `amazon-products-YYYYMMDD.csv` |
| TCGPlayer candidates and confirmed matches | Results for the current job, or Database → TCGPlayer | `tcgplayer-matches-….csv` |
| Confirmed Amazon ↔ TCGPlayer pairs, with both prices and the difference (Amazon minus TCGPlayer) | Results for the current job, Database → Price compare, or the compare page for one pair | `price-compare-….csv` |

The date is UTC. A job-scoped file includes `job-<id>` in the name. Columns follow the table, plus product id, ASIN, and URLs.

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
| GET | `/api/jobs/{id}/observations` | Cards for a job (`q`, `min_price`, `max_price`, `min_rating`, `min_bought`, `sort` including `bought`). Each card includes its current TCGPlayer match when one is stored |
| POST | `/api/jobs/{id}/tcg-match` | Queue a TCGPlayer match for that job’s products, or a `product_ids` subset |
| DELETE | `/api/jobs/{id}/tcg-match` | Clear TCGPlayer matches for products in that job |
| POST | `/api/products/tcg-match` | Queue a match for `product_ids` |
| DELETE | `/api/products/{id}/tcg-match` | Clear one product’s TCGPlayer match |
| POST | `/api/products/{id}/tcg-confirm` | Confirm one stored candidate (`candidate_id`) as the match |
| GET | `/api/products/{id}/compare` | Amazon price beside the confirmed TCGPlayer price. 409 until the listing is confirmed |
| GET | `/api/exports/{kind}` | Download `amazon-products`, `tcgplayer-matches`, or `price-compare`. `format` is `csv`, `xlsx`, or `json`. Job lists take `job_id` plus the Results filters (`q`, `min_rating`, `sort`). Catalog lists take `q`, `has_asin`, `last_seen_after`, `last_seen_before`. `product_id` limits a price compare to one pair |
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
backend/app/tcg/      TCGPlayer query, match, and fixture search HTML
backend/app/exports.py CSV and Excel for Amazon, TCGPlayer, and price compare
backend/app/fixtures/ Saved Amazon-like HTML for dry-runs
backend/tests/        Parser, upsert, and API tests
frontend/             React + Vite operator UI
data/                 SQLite database and settings (created at runtime)
```
