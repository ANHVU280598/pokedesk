import { useCallback, useEffect, useState } from "react"
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
import { ConfirmTcg } from "../components/ConfirmTcg"
import { ExportGroup } from "../components/ExportMenu"
import { MatchBanner } from "../components/MatchBanner"
import { TcgMatchCell } from "../components/TcgMatch"
import { CompareList, TcgList } from "./CatalogLists"
import {
  ApiError,
  clearProductTcgMatch,
  deleteJob,
  deleteObservation,
  deleteProduct,
  getProduct,
  listDuplicates,
  listJobs,
  listProducts,
  matchProductsOnTcg,
  mergeProducts,
  updateProduct,
} from "../api"
import { formatBought, formatMoney, formatWhen, sourceLabel } from "../format"
import type { CatalogProduct, DuplicateHint, Job, Product } from "../types"

const PAGE = 25

type Tab = "products" | "tcg" | "compare" | "jobs" | "duplicates"

export function Database({
  onCompare,
}: {
  onCompare: (productId: number) => void
}) {
  const [tab, setTab] = useState<Tab>("products")

  return (
    <div>
      <header className="mb-5 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Database</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Products are one row per ASIN. The same ASIN in another job adds a price snapshot, not a second product. Cards with no ASIN stay separate. Merge is how you combine a no-ASIN card with the ASIN row, or two rows that are the same item.
        </p>
      </header>
      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["products", "Products"],
            ["tcg", "TCGPlayer"],
            ["compare", "Price compare"],
            ["jobs", "Jobs"],
            ["duplicates", "Duplicates"],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={tab === id ? "default" : "outline"}
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      {tab === "products" ? (
        <Products onCompare={onCompare} />
      ) : tab === "tcg" ? (
        <TcgList />
      ) : tab === "compare" ? (
        <CompareList onCompare={onCompare} />
      ) : tab === "jobs" ? (
        <Jobs />
      ) : (
        <Duplicates />
      )}
    </div>
  )
}

function Products({
  onCompare,
}: {
  onCompare: (productId: number) => void
}) {
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [hasAsin, setHasAsin] = useState("any")
  const [seenAfter, setSeenAfter] = useState("")
  const [seenBefore, setSeenBefore] = useState("")
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<CatalogProduct[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [matching, setMatching] = useState(false)
  const [matchNote, setMatchNote] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [matchJobId, setMatchJobId] = useState<number | null>(null)
  const [queuing, setQueuing] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 200)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    setOffset(0)
  }, [debounced, hasAsin, seenAfter, seenBefore])

  useEffect(() => {
    let cancel = false
    setError(null)
    listProducts({
      q: debounced,
      has_asin: hasAsin,
      last_seen_after: seenAfter,
      last_seen_before: seenBefore,
      limit: PAGE,
      offset,
    })
      .then((page) => {
        if (cancel) return
        setItems(page.items)
        setTotal(page.total)
      })
      .catch((err: unknown) => {
        if (!cancel) {
          setItems([])
          setError(err instanceof ApiError ? err.message : "Could not load products.")
        }
      })
    return () => {
      cancel = true
    }
  }, [debounced, hasAsin, seenAfter, seenBefore, offset])

  function reload() {
    setOffset((current) => current)
    listProducts({
      q: debounced,
      has_asin: hasAsin,
      last_seen_after: seenAfter,
      last_seen_before: seenBefore,
      limit: PAGE,
      offset,
    })
      .then((page) => {
        setItems(page.items)
        setTotal(page.total)
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Could not load products.")
      })
  }

  const page = Math.floor(offset / PAGE) + 1
  const pages = Math.max(1, Math.ceil(total / PAGE))

  async function runMatch(rematch: boolean, productIds?: number[]) {
    if (matchJobId != null) return
    setQueuing(true)
    setMatching(true)
    setError(null)
    setMatchNote(null)
    try {
      const queued = await matchProductsOnTcg({
        rematch: rematch || productIds?.length === 1,
        productIds,
        q: productIds ? undefined : debounced,
        hasAsin: productIds ? undefined : hasAsin,
        lastSeenAfter: productIds ? undefined : seenAfter,
        lastSeenBefore: productIds ? undefined : seenBefore,
      })
      setMatchJobId(queued.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "TCGPlayer match failed.")
    } finally {
      setQueuing(false)
      setMatching(false)
    }
  }

  const refreshDuringMatch = useCallback(() => {
    reload()
  }, [debounced, hasAsin, seenAfter, seenBefore, offset])

  const finishMatch = useCallback((job: Job) => {
    setMatchJobId(null)
    if (job.status === "failed") {
      setError(job.error_message || "TCGPlayer match failed.")
      setMatchNote(null)
    } else {
      setMatchNote(job.error_message || "Match finished.")
    }
    reload()
  }, [debounced, hasAsin, seenAfter, seenBefore, offset])

  return (
    <div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="catalog-q">Search</Label>
          <Input
            id="catalog-q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Title, ASIN, or URL"
            className="h-10"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="catalog-asin">ASIN</Label>
          <select
            id="catalog-asin"
            value={hasAsin}
            onChange={(event) => setHasAsin(event.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-card px-2.5 text-sm"
          >
            <option value="any">Any</option>
            <option value="yes">Has ASIN</option>
            <option value="no">No ASIN</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="seen-after">Seen from</Label>
            <Input
              id="seen-after"
              type="date"
              value={seenAfter}
              onChange={(event) => setSeenAfter(event.target.value)}
              className="h-10"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="seen-before">Seen through</Label>
            <Input
              id="seen-before"
              type="date"
              value={seenBefore}
              onChange={(event) => setSeenBefore(event.target.value)}
              className="h-10"
            />
          </div>
        </div>
      </div>
      <div className="mb-4 rounded-xl border bg-card p-3">
        <ExportGroup
          label="Export current list"
          hint="Amazon products that match these filters. Clear the filters to export the whole catalog."
          dataset="amazon-products"
          params={{
            q: debounced,
            has_asin: hasAsin === "any" ? "" : hasAsin,
            last_seen_after: seenAfter,
            last_seen_before: seenBefore,
          }}
        />
      </div>
      {queuing ? <p className="mb-3 text-sm text-sky-950">Queuing the TCGPlayer match for this list…</p> : null}
      <MatchBanner jobId={matchJobId} onTick={refreshDuringMatch} onFinished={finishMatch} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={matching || matchJobId != null || total === 0} onClick={() => void runMatch(false)}>
          {queuing ? "Queuing…" : "Match on TCGPlayer"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={matching || matchJobId != null || total === 0}
          onClick={() => void runMatch(true)}
        >
          Re-match all
        </Button>
        <p className="text-xs text-muted-foreground">
          Matches every product in this filtered catalog, not only this page. Products that already have a match are skipped unless you choose Re-match all.
        </p>
        {matchNote ? <p className="text-sm text-muted-foreground">{matchNote}</p> : null}
      </div>
      {items?.some((item) => item.tcg_status === "needs_confirm") ? (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Some products have more than one plausible TCGPlayer listing. Choose a listing before that product counts as matched.
        </p>
      ) : null}
      {error ? (
        <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
      ) : null}
      {items == null ? (
        <p className="text-sm text-muted-foreground">Loading products…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card px-5 py-10 text-sm text-muted-foreground">
          No products match. Run a scrape, or clear the filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">ASIN</th>
                <th className="px-3 py-2 font-medium">Last seen</th>
                <th className="px-3 py-2 font-medium">Bought last month</th>
                <th className="px-3 py-2 font-medium">TCGPlayer</th>
                <th className="px-3 py-2 font-medium">Snapshots</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="cursor-pointer border-t hover:bg-muted/50"
                  onClick={() => setSelectedId(item.id)}
                >
                  <td className="max-w-[360px] truncate px-3 py-2">{item.title}</td>
                  <td className="px-3 py-2 font-mono text-xs">{item.asin || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatWhen(item.last_seen_at)}</td>
                  <td className="px-3 py-2">
                    {formatBought(item.bought_past_month, item.bought_past_month_text)}
                  </td>
                  <td className="px-3 py-2">
                    <TcgMatchCell
                      match={item}
                      productId={item.id}
                      onConfirm={setConfirmId}
                      onCompare={onCompare}
                    />
                  </td>
                  <td className="px-3 py-2">{item.observation_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total} product{total === 1 ? "" : "s"} · page {page} of {pages}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={offset + PAGE >= total}
            onClick={() => setOffset(offset + PAGE)}
          >
            Next
          </Button>
        </div>
      </div>
      <ProductEditor
        productId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={reload}
        onMatchOne={(productId) => void runMatch(true, [productId])}
        onConfirm={setConfirmId}
        onCompare={onCompare}
      />
      <ConfirmTcg
        productId={confirmId}
        onClose={() => setConfirmId(null)}
        onConfirmed={(productId) => {
          setConfirmId(null)
          setSelectedId(null)
          reload()
          onCompare(productId)
        }}
      />
    </div>
  )
}

function ProductEditor({
  productId,
  onClose,
  onChanged,
  onMatchOne,
  onConfirm,
  onCompare,
}: {
  productId: number | null
  onClose: () => void
  onChanged: () => void
  onMatchOne: (productId: number) => void
  onConfirm: (productId: number) => void
  onCompare: (productId: number) => void
}) {
  const [product, setProduct] = useState<Product | null>(null)
  const [section, setSection] = useState<"edit" | "observations">("edit")
  const [title, setTitle] = useState("")
  const [asin, setAsin] = useState("")
  const [imageUrl, setImageUrl] = useState("")
  const [productUrl, setProductUrl] = useState("")
  const [breadcrumbs, setBreadcrumbs] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (productId == null) {
      setProduct(null)
      return
    }
    let cancel = false
    setError(null)
    setSection("edit")
    getProduct(productId)
      .then((loaded) => {
        if (cancel) return
        setProduct(loaded)
        setTitle(loaded.title)
        setAsin(loaded.asin || "")
        setImageUrl(loaded.image_url || "")
        setProductUrl(loaded.product_url || "")
        setBreadcrumbs(loaded.category_breadcrumbs || "")
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof ApiError ? err.message : "Could not load this product.")
      })
    return () => {
      cancel = true
    }
  }, [productId])

  async function save() {
    if (productId == null) return
    setPending(true)
    setError(null)
    try {
      const saved = await updateProduct(productId, {
        title: title.trim(),
        asin: asin.trim() || null,
        image_url: imageUrl.trim() || null,
        product_url: productUrl.trim() || null,
        category_breadcrumbs: breadcrumbs.trim() || null,
      })
      setProduct(saved)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.")
    } finally {
      setPending(false)
    }
  }

  async function remove() {
    if (product == null) return
    const hasRows = product.observations.length > 0
    const message = hasRows
      ? `Delete “${product.title}” and its ${product.observations.length} stored snapshot${product.observations.length === 1 ? "" : "s"}?`
      : `Delete “${product.title}”?`
    if (!window.confirm(message)) return
    setPending(true)
    setError(null)
    try {
      await deleteProduct(product.id, hasRows)
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete.")
    } finally {
      setPending(false)
    }
  }

  function rematch() {
    if (productId == null) return
    setError(null)
    onMatchOne(productId)
  }

  async function clearMatch() {
    if (productId == null) return
    setPending(true)
    setError(null)
    try {
      const loaded = await clearProductTcgMatch(productId)
      setProduct(loaded)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not clear the match.")
    } finally {
      setPending(false)
    }
  }

  async function removeObservation(id: number) {
    if (!window.confirm("Delete this snapshot? The product row stays.")) return
    setPending(true)
    setError(null)
    try {
      await deleteObservation(id)
      if (productId != null) {
        const loaded = await getProduct(productId)
        setProduct(loaded)
      }
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the snapshot.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Sheet open={productId != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{product?.title || "Product"}</SheetTitle>
          <SheetDescription>
            Editing the product changes the catalog row. Snapshots keep the price from each job.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          <div className="flex gap-2">
            <Button size="sm" variant={section === "edit" ? "default" : "outline"} onClick={() => setSection("edit")}>
              Edit
            </Button>
            <Button
              size="sm"
              variant={section === "observations" ? "default" : "outline"}
              onClick={() => setSection("observations")}
            >
              Snapshots
            </Button>
          </div>
          {error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
          ) : null}
          {product == null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : section === "edit" ? (
            <div className="space-y-3">
              <Field label="Title" value={title} onChange={setTitle} />
              <Field label="ASIN" value={asin} onChange={setAsin} mono />
              <Field label="Image URL" value={imageUrl} onChange={setImageUrl} />
              <Field label="Product URL" value={productUrl} onChange={setProductUrl} />
              <Field label="Breadcrumbs" value={breadcrumbs} onChange={setBreadcrumbs} />
              <div className="rounded-lg border p-3 text-sm">
                <p className="text-xs text-muted-foreground">TCGPlayer</p>
                <div className="mt-1">
                  <TcgMatchCell
                    match={product}
                    productId={product.id}
                    onConfirm={onConfirm}
                    onCompare={onCompare}
                  />
                </div>
                {product.tcg_query ? (
                  <p className="mt-1 text-xs text-muted-foreground">Searched “{product.tcg_query}”</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void rematch()}>
                    {pending ? "Working…" : "Re-run match"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending || !product.tcg_status}
                    onClick={() => void clearMatch()}
                  >
                    Clear match
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={pending} onClick={() => void save()}>
                  {pending ? "Saving…" : "Save"}
                </Button>
                <Button type="button" variant="destructive" disabled={pending} onClick={() => void remove()}>
                  Delete
                </Button>
              </div>
            </div>
          ) : product.observations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No snapshots on this product.</p>
          ) : (
            <ul className="space-y-2">
              {product.observations.map((item) => (
                <li key={item.observation_id} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{formatMoney(item.price, item.currency)}</div>
                      <div className="text-xs text-muted-foreground">
                        Bought last month {formatBought(item.bought_past_month, item.bought_past_month_text)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Job {item.job_id} · {formatWhen(item.observed_at)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => void removeObservation(item.observation_id)}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Field({
  label,
  value,
  onChange,
  mono,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  mono?: boolean
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-")
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`h-10 ${mono ? "font-mono" : ""}`}
      />
    </div>
  )
}

function Jobs() {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<number | null>(null)

  function load() {
    listJobs()
      .then(setJobs)
      .catch((err: unknown) => {
        setJobs([])
        setError(err instanceof ApiError ? err.message : "Could not load jobs.")
      })
  }

  useEffect(() => {
    load()
  }, [])

  async function remove(job: Job) {
    if (!window.confirm(`Delete job ${job.id} and its snapshots? Product rows stay.`)) return
    setPendingId(job.id)
    setError(null)
    try {
      await deleteJob(job.id)
      load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the job.")
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        Deleting a job removes its snapshots and page records. Products that other jobs still reference stay in the catalog.
      </p>
      {error ? (
        <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
      ) : null}
      {jobs == null ? (
        <p className="text-sm text-muted-foreground">Loading jobs…</p>
      ) : jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card px-5 py-10 text-sm text-muted-foreground">
          No jobs yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Job</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const locked = job.status === "queued" || job.status === "running" || job.status === "paused"
                return (
                  <tr key={job.id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">
                      #{job.id}
                      {job.parent_job_id ? (
                        <div className="text-xs text-muted-foreground">Follow-up of #{job.parent_job_id}</div>
                      ) : null}
                    </td>
                    <td className="max-w-[280px] truncate px-3 py-2">{sourceLabel(job)}</td>
                    <td className="px-3 py-2">{job.status}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={locked || pendingId === job.id}
                        onClick={() => void remove(job)}
                      >
                        {locked ? "Finish first" : pendingId === job.id ? "Deleting…" : "Delete"}
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Duplicates() {
  const [hints, setHints] = useState<DuplicateHint[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  function load() {
    listDuplicates()
      .then((page) => setHints(page.hints))
      .catch((err: unknown) => {
        setHints([])
        setError(err instanceof ApiError ? err.message : "Could not look for duplicates.")
      })
  }

  useEffect(() => {
    load()
  }, [])

  async function merge(hint: DuplicateHint) {
    const label = hint.drop_asin || hint.drop_title
    if (!window.confirm(`Merge “${label}” into product #${hint.keep_id}? Snapshots move to the kept row.`)) return
    setPending(hint.id)
    setError(null)
    try {
      await mergeProducts(hint.keep_id, hint.drop_id)
      load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Merge failed.")
    } finally {
      setPending(null)
    }
  }

  return (
    <div>
      <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
        Hints are products that share a normalized title, or a no-ASIN card whose title or URL matches a card that has an ASIN. Merge keeps the ASIN row when there is one. A scrape will also attach a new ASIN onto a single matching no-ASIN card when the title is long enough or the product URL matches. It will not guess when several no-ASIN cards share a title.
      </p>
      {error ? (
        <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
      ) : null}
      {hints == null ? (
        <p className="text-sm text-muted-foreground">Looking for duplicates…</p>
      ) : hints.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card px-5 py-10 text-sm text-muted-foreground">
          No duplicate hints right now.
        </div>
      ) : (
        <ul className="space-y-2">
          {hints.map((hint) => (
            <li key={hint.id} className="rounded-xl border bg-card p-4 text-sm">
              <p className="font-medium">{hint.reason}</p>
              <p className="mt-1 text-muted-foreground">
                Keep #{hint.keep_id}
                {hint.keep_asin ? ` · ${hint.keep_asin}` : ""} · {hint.keep_title}
              </p>
              <p className="text-muted-foreground">
                Merge #{hint.drop_id}
                {hint.drop_asin ? ` · ${hint.drop_asin}` : " · no ASIN"} · {hint.drop_title}
              </p>
              <Button
                className="mt-3"
                size="sm"
                disabled={pending != null}
                onClick={() => void merge(hint)}
              >
                {pending === hint.id ? "Merging…" : "Merge"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
