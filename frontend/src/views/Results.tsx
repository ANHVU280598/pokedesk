import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { TcgMatchCell } from "../components/TcgMatch"
import {
  ApiError,
  clearJobTcgMatches,
  clearProductTcgMatch,
  getProduct,
  listJobs,
  listObservations,
  matchJobOnTcg,
} from "../api"
import { formatBought, formatCount, formatMoney, formatRating, formatWhen, sourceLabel } from "../format"
import type { Job, MatchHandoff, Observation, Product } from "../types"

export function Results({
  initialJobId,
  onStartMatch,
}: {
  initialJobId: number | null
  onStartMatch: (matchJobId: number, returnTo: MatchHandoff) => void
}) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [jobId, setJobId] = useState<number | null>(initialJobId)
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [minRating, setMinRating] = useState("")
  const [sort, setSort] = useState("page")
  const [layout, setLayout] = useState<"table" | "grid">("table")
  const [items, setItems] = useState<Observation[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<Observation | null>(null)
  const [matching, setMatching] = useState(false)
  const [matchNote, setMatchNote] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    setJobId(initialJobId)
  }, [initialJobId])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 200)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let cancel = false
    listJobs()
      .then((rows) => {
        if (cancel) return
        setJobs(rows)
        setJobId((current) => {
          if (current != null) return current
          const amazon = rows.find((job) => job.settings.mode !== "tcgplayer")
          return amazon?.id ?? null
        })
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof ApiError ? err.message : "Could not load jobs.")
      })
    return () => {
      cancel = true
    }
  }, [])

  useEffect(() => {
    if (jobId == null) {
      setLoading(false)
      setItems([])
      setTotal(0)
      return
    }
    let cancel = false
    setLoading(true)
    listObservations(jobId, {
      q: debounced || undefined,
      min_rating: minRating ? Number(minRating) : undefined,
      sort,
      limit: 500,
    })
      .then((page) => {
        if (cancel) return
        setItems(page.items)
        setTotal(page.total)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof ApiError ? err.message : "Could not load results.")
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [jobId, debounced, minRating, sort, reloadKey])

  async function runMatch() {
    if (jobId == null) return
    setMatching(true)
    setError(null)
    setMatchNote(null)
    try {
      const queued = await matchJobOnTcg(jobId)
      onStartMatch(queued.id, { view: "results", jobId })
    } catch (err) {
      setMatching(false)
      setError(err instanceof ApiError ? err.message : "TCGPlayer match failed.")
    }
  }

  async function clearMatches() {
    if (jobId == null) return
    setMatching(true)
    setError(null)
    try {
      const result = await clearJobTcgMatches(jobId)
      setMatchNote(
        result.cleared
          ? `Cleared ${result.cleared} TCGPlayer match${result.cleared === 1 ? "" : "es"}.`
          : "No TCGPlayer matches on this job.",
      )
      setReloadKey((value) => value + 1)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not clear matches.")
    } finally {
      setMatching(false)
    }
  }

  const filtering = Boolean(debounced || minRating)
  const amazonJobs = jobs.filter((job) => job.settings.mode !== "tcgplayer")
  const hasMatches = items.some((item) => item.tcg_status)

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Results</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {jobId == null ? "No scrapes yet." : `${total} card${total === 1 ? "" : "s"} in this job`}
          </p>
          <p className="mt-2 max-w-xl text-xs text-muted-foreground">
            One product per ASIN. The same ASIN in a later job updates that product and adds a snapshot. Cards without an ASIN are not folded together. Merge those from Database.
          </p>
        </div>
        <div className="flex rounded-lg border bg-card p-1">
          <Button
            type="button"
            size="sm"
            variant={layout === "table" ? "default" : "ghost"}
            onClick={() => setLayout("table")}
          >
            Table
          </Button>
          <Button
            type="button"
            size="sm"
            variant={layout === "grid" ? "default" : "ghost"}
            onClick={() => setLayout("grid")}
          >
            Grid
          </Button>
        </div>
      </header>

      <div className="mb-4 grid gap-3 rounded-xl border bg-card p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_140px_140px]">
        <div className="space-y-1">
          <Label htmlFor="job">Job</Label>
          <select
            id="job"
            value={jobId ?? ""}
            onChange={(event) => setJobId(event.target.value ? Number(event.target.value) : null)}
            className="h-10 w-full rounded-lg border border-input bg-card px-2.5 text-sm"
          >
            {amazonJobs.length === 0 ? <option value="">No jobs</option> : null}
            {amazonJobs.map((job) => (
              <option key={job.id} value={job.id}>
                #{job.id} · {sourceLabel(job)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="search">Search</Label>
          <Input
            id="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Title or ASIN"
            className="h-10"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rating">Min rating</Label>
          <select
            id="rating"
            value={minRating}
            onChange={(event) => setMinRating(event.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-card px-2.5 text-sm"
          >
            <option value="">Any</option>
            <option value="4">4+</option>
            <option value="3">3+</option>
            <option value="2">2+</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sort">Sort</Label>
          <select
            id="sort"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-card px-2.5 text-sm"
          >
            <option value="page">Page order</option>
            <option value="price_asc">Price low</option>
            <option value="price_desc">Price high</option>
            <option value="rating">Rating</option>
            <option value="bought">Bought last month</option>
          </select>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={jobId == null || matching || items.length === 0} onClick={() => void runMatch()}>
          {matching ? "Matching…" : "Match on TCGPlayer"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={jobId == null || matching || !hasMatches}
          onClick={() => void clearMatches()}
        >
          Clear matches
        </Button>
        <p className="text-xs text-muted-foreground">
          Click to look up this job on TCGPlayer. Matching stays idle until you do.
        </p>
        {matchNote ? <p className="text-sm text-muted-foreground">{matchNote}</p> : null}
      </div>

      {error ? (
        <p className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
      ) : null}

      {jobId == null ? (
        <Empty message="Run a scrape and the cards will show up here." />
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading cards…</p>
      ) : items.length === 0 ? (
        <Empty
          message={
            filtering
              ? "No cards match these filters."
              : "This scrape stored no cards."
          }
        />
      ) : layout === "table" ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Card</th>
                <th className="px-3 py-2 font-medium">ASIN</th>
                <th className="px-3 py-2 font-medium">Price</th>
                <th className="px-3 py-2 font-medium">List</th>
                <th className="px-3 py-2 font-medium">Rating</th>
                <th className="px-3 py-2 font-medium">Reviews</th>
                <th className="px-3 py-2 font-medium">Bought last month</th>
                <th className="px-3 py-2 font-medium">TCGPlayer</th>
                <th className="px-3 py-2 font-medium">Page</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.observation_id}
                  tabIndex={0}
                  className="cursor-pointer border-t hover:bg-muted/70"
                  onClick={() => setDetail(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      setDetail(item)
                    }
                  }}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      <Thumb src={item.image_url} />
                      <span className="min-w-0">
                        <span className="line-clamp-2 font-medium">{item.title}</span>
                        {item.source === "related" ? (
                          <Badge variant="secondary" className="mt-1">
                            Related
                          </Badge>
                        ) : null}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{item.asin || "—"}</td>
                  <td className="px-3 py-2">{formatMoney(item.price, item.currency)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatMoney(item.list_price, item.currency)}</td>
                  <td className="px-3 py-2">{formatRating(item.rating)}</td>
                  <td className="px-3 py-2">{formatCount(item.review_count)}</td>
                  <td className="px-3 py-2">{formatBought(item.bought_past_month, item.bought_past_month_text)}</td>
                  <td className="px-3 py-2">
                    <TcgMatchCell match={item} />
                  </td>
                  <td className="px-3 py-2">{item.page_number ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <button
              key={item.observation_id}
              type="button"
              onClick={() => setDetail(item)}
              className="overflow-hidden rounded-xl border bg-card text-left shadow-sm hover:border-primary/40"
            >
              <Thumb src={item.image_url} large />
              <div className="space-y-1 p-3">
                <p className="line-clamp-2 text-sm font-medium">{item.title}</p>
                {item.source === "related" ? <Badge variant="secondary">Related</Badge> : null}
                <p className="text-sm">{formatMoney(item.price, item.currency)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatRating(item.rating)} · {formatCount(item.review_count)} reviews
                </p>
                <p className="text-xs text-muted-foreground">
                  Bought last month {formatBought(item.bought_past_month, item.bought_past_month_text)}
                </p>
                <TcgMatchCell match={item} />
              </div>
            </button>
          ))}
        </div>
      )}

      <DetailDrawer
        item={detail}
        onClose={() => setDetail(null)}
        onChanged={() => setReloadKey((value) => value + 1)}
        onStartMatch={onStartMatch}
      />
    </div>
  )
}

function Empty({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-card px-5 py-10 text-sm text-muted-foreground">
      {message}
    </div>
  )
}

function Thumb({ src, large = false }: { src: string | null; large?: boolean }) {
  const [failed, setFailed] = useState(false)
  const className = large
    ? "aspect-square w-full bg-muted object-contain"
    : "size-10 shrink-0 rounded bg-muted object-contain"
  if (!src || failed) return <div className={className} />
  return (
    <img
      src={src}
      alt=""
      className={className}
      onError={() => setFailed(true)}
    />
  )
}

function DetailDrawer({
  item,
  onClose,
  onChanged,
  onStartMatch,
}: {
  item: Observation | null
  onClose: () => void
  onChanged: () => void
  onStartMatch: (matchJobId: number, returnTo: MatchHandoff) => void
}) {
  const [product, setProduct] = useState<Product | null>(null)
  const [copyLabel, setCopyLabel] = useState("Copy ASIN")
  const [matchBusy, setMatchBusy] = useState(false)
  const [matchError, setMatchError] = useState<string | null>(null)

  useEffect(() => {
    setCopyLabel("Copy ASIN")
    if (!item) {
      setProduct(null)
      return
    }
    let cancel = false
    getProduct(item.product_id)
      .then((next) => {
        if (!cancel) setProduct(next)
      })
      .catch(() => {
        if (!cancel) setProduct(null)
      })
    return () => {
      cancel = true
    }
  }, [item])

  const href =
    item?.product_url || (item?.asin ? `https://www.amazon.com/dp/${item.asin}` : null)

  async function copyAsin() {
    if (!item?.asin) return
    try {
      await navigator.clipboard.writeText(item.asin)
      setCopyLabel("Copied")
    } catch {
      setCopyLabel("Copy failed")
    }
    window.setTimeout(() => setCopyLabel("Copy ASIN"), 1200)
  }

  async function rematchOne() {
    if (!item) return
    setMatchBusy(true)
    setMatchError(null)
    try {
      const queued = await matchJobOnTcg(item.job_id, [item.product_id])
      onStartMatch(queued.id, { view: "results", jobId: item.job_id })
    } catch (err) {
      setMatchError(err instanceof ApiError ? err.message : "Could not re-run the match.")
    } finally {
      setMatchBusy(false)
    }
  }

  async function clearOne() {
    if (!item) return
    setMatchBusy(true)
    setMatchError(null)
    try {
      await clearProductTcgMatch(item.product_id)
      onChanged()
      const next = await getProduct(item.product_id)
      setProduct(next)
    } catch (err) {
      setMatchError(err instanceof ApiError ? err.message : "Could not clear the match.")
    } finally {
      setMatchBusy(false)
    }
  }

  return (
    <Sheet open={item != null} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="overflow-y-auto" style={{ maxWidth: 440 }}>
        <SheetHeader>
          <SheetTitle className="pr-8 text-lg leading-snug">{item?.title || "Card"}</SheetTitle>
          {item?.source === "related" ? (
            <Badge variant="secondary" className="mt-2 w-fit">
              Related
            </Badge>
          ) : null}
          <SheetDescription>
            {item?.seller ? `Sold by ${item.seller}` : "Product card from this scrape"}
          </SheetDescription>
        </SheetHeader>
        {item ? (
          <div className="space-y-4 px-4 pb-6">
              <Thumb src={item.image_url} large />
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">ASIN</dt>
                  <dd className="font-mono">{item.asin || "Not on the card"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Price</dt>
                  <dd>{formatMoney(item.price, item.currency)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">List price</dt>
                  <dd>{formatMoney(item.list_price, item.currency)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Rating</dt>
                  <dd>
                    {formatRating(item.rating)} · {formatCount(item.review_count)} reviews
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Bought last month</dt>
                  <dd>{formatBought(item.bought_past_month, item.bought_past_month_text)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Page</dt>
                  <dd>{item.page_number ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Seen</dt>
                  <dd>{formatWhen(item.observed_at)}</dd>
                </div>
              </dl>
              {item.badges.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {item.badges.map((badge) => (
                    <Badge key={badge} variant="secondary">
                      {badge}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {item.availability_snippet ? (
                <p className="text-sm text-muted-foreground">{item.availability_snippet}</p>
              ) : null}
              <div>
                <p className="text-xs text-muted-foreground">TCGPlayer</p>
                <div className="mt-1">
                  <TcgMatchCell match={product ?? item} />
                </div>
                {(product ?? item).tcg_query ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Searched “{(product ?? item).tcg_query}”
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={matchBusy}
                    onClick={() => void rematchOne()}
                  >
                    {matchBusy ? "Matching…" : "Re-run match"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={matchBusy || !(product ?? item).tcg_status}
                    onClick={() => void clearOne()}
                  >
                    Clear match
                  </Button>
                </div>
                {matchError ? <p className="mt-2 text-sm text-rose-800">{matchError}</p> : null}
              </div>
              {product?.category_breadcrumbs ? (
                <p className="text-xs text-muted-foreground">{product.category_breadcrumbs}</p>
              ) : null}
              {product && product.observations.length > 1 ? (
                <p className="text-xs text-muted-foreground">
                  Stored in {product.observations.length} scrapes.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-2">
                {href ? (
                  <Button asChild>
                    <a href={href} target="_blank" rel="noreferrer">
                      Open on Amazon
                    </a>
                  </Button>
                ) : null}
                <Button variant="outline" disabled={!item.asin} onClick={copyAsin}>
                  {copyLabel}
                </Button>
              </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
