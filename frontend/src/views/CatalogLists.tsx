import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ExportGroup } from "../components/ExportMenu"
import { ApiError, listExport } from "../api"
import { formatBought, formatMoney } from "../format"
import type { CompareExportRow, TcgExportRow } from "../types"

export function TcgList() {
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [items, setItems] = useState<TcgExportRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 200)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let cancel = false
    setError(null)
    listExport<TcgExportRow>("tcgplayer-matches", { q: debounced, limit: 500 })
      .then((page) => {
        if (cancel) return
        setItems(page.items)
        setTotal(page.total)
      })
      .catch((err: unknown) => {
        if (!cancel) {
          setItems([])
          setError(err instanceof ApiError ? err.message : "Could not load TCGPlayer listings.")
        }
      })
    return () => {
      cancel = true
    }
  }, [debounced])

  return (
    <div>
      <div className="mb-4 max-w-md space-y-1">
        <Label htmlFor="tcg-q">Search</Label>
        <Input
          id="tcg-q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Amazon title, ASIN, or TCGPlayer name"
          className="h-10"
        />
      </div>
      <div className="mb-4 rounded-xl border bg-card p-3">
        <ExportGroup
          label="Export current list"
          hint="Candidates and confirmed matches. A blank price was not on the listing. Clear search to export every TCGPlayer row."
          dataset="tcgplayer-matches"
          params={{ q: debounced }}
        />
      </div>
      {error ? (
        <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
      ) : null}
      {items == null ? (
        <p className="text-sm text-muted-foreground">Loading TCGPlayer listings…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card px-5 py-10 text-sm text-muted-foreground">
          No TCGPlayer listings yet. Match a job from Results. Several plausible hits stay here until you confirm one.
        </div>
      ) : (
        <>
          <Count shown={items.length} total={total} />
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-3 py-2 font-medium">Amazon</th>
                  <th className="px-3 py-2 font-medium">ASIN</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">TCGPlayer</th>
                  <th className="px-3 py-2 font-medium">Set</th>
                  <th className="px-3 py-2 font-medium">Price</th>
                  <th className="px-3 py-2 font-medium">Confirmed</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={`${item.product_id}-${item.candidate_id ?? "match"}-${index}`} className="border-t">
                    <td className="max-w-[280px] px-3 py-2">{item.amazon_title}</td>
                    <td className="px-3 py-2 font-mono text-xs">{item.asin || "—"}</td>
                    <td className="px-3 py-2">{statusLabel(item.match_status)}</td>
                    <td className="px-3 py-2">
                      {item.tcg_url ? (
                        <a href={item.tcg_url} target="_blank" rel="noreferrer" className="text-primary underline">
                          {item.tcg_name || "TCGPlayer"}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">{item.tcg_name || "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{item.set_name || "—"}</td>
                    <td className="px-3 py-2">
                      {item.price == null
                        ? "—"
                        : `${item.price_label ? `${item.price_label} ` : ""}${formatMoney(item.price, item.currency)}`}
                    </td>
                    <td className="px-3 py-2">{item.confirmed === "yes" ? "Yes" : item.confirmed === "no" ? "No" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

export function CompareList({ onCompare }: { onCompare: (productId: number) => void }) {
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [items, setItems] = useState<CompareExportRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 200)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let cancel = false
    setError(null)
    listExport<CompareExportRow>("price-compare", { q: debounced, limit: 500 })
      .then((page) => {
        if (cancel) return
        setItems(page.items)
        setTotal(page.total)
      })
      .catch((err: unknown) => {
        if (!cancel) {
          setItems([])
          setError(err instanceof ApiError ? err.message : "Could not load price comparisons.")
        }
      })
    return () => {
      cancel = true
    }
  }, [debounced])

  return (
    <div>
      <div className="mb-4 max-w-md space-y-1">
        <Label htmlFor="compare-q">Search</Label>
        <Input
          id="compare-q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Amazon title, ASIN, or TCGPlayer name"
          className="h-10"
        />
      </div>
      <div className="mb-4 rounded-xl border bg-card p-3">
        <ExportGroup
          label="Export current list"
          hint="Confirmed pairs only. Difference is Amazon minus TCGPlayer. A missing price stays blank."
          dataset="price-compare"
          params={{ q: debounced }}
        />
      </div>
      {error ? (
        <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
      ) : null}
      {items == null ? (
        <p className="text-sm text-muted-foreground">Loading confirmed pairs…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card px-5 py-10 text-sm text-muted-foreground">
          No confirmed pairs yet. A single strong match is ready to compare. When several listings fit, confirm one first.
        </div>
      ) : (
        <>
          <Count shown={items.length} total={total} />
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-3 py-2 font-medium">Amazon</th>
                  <th className="px-3 py-2 font-medium">ASIN</th>
                  <th className="px-3 py-2 font-medium">Amazon price</th>
                  <th className="px-3 py-2 font-medium">Bought last month</th>
                  <th className="px-3 py-2 font-medium">TCGPlayer</th>
                  <th className="px-3 py-2 font-medium">TCGPlayer price</th>
                  <th className="px-3 py-2 font-medium">Difference</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.product_id} className="border-t">
                    <td className="max-w-[240px] px-3 py-2">{item.amazon_title}</td>
                    <td className="px-3 py-2 font-mono text-xs">{item.asin || "—"}</td>
                    <td className="px-3 py-2">{formatMoney(item.amazon_price, item.amazon_currency)}</td>
                    <td className="px-3 py-2">
                      {formatBought(item.bought_past_month, item.bought_past_month_text)}
                    </td>
                    <td className="px-3 py-2">
                      {item.tcg_url ? (
                        <a href={item.tcg_url} target="_blank" rel="noreferrer" className="text-primary underline">
                          {item.tcg_name || "TCGPlayer"}
                        </a>
                      ) : (
                        item.tcg_name || "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {item.tcg_price == null
                        ? "—"
                        : `${item.tcg_price_label ? `${item.tcg_price_label} ` : ""}${formatMoney(item.tcg_price, item.tcg_currency)}`}
                    </td>
                    <td className="px-3 py-2">{gapLabel(item)}</td>
                    <td className="px-3 py-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => onCompare(item.product_id)}>
                        Compare
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Count({ shown, total }: { shown: number; total: number }) {
  if (shown >= total) {
    return (
      <p className="mb-2 text-xs text-muted-foreground">
        {total} row{total === 1 ? "" : "s"}
      </p>
    )
  }
  return (
    <p className="mb-2 text-xs text-muted-foreground">
      Showing {shown} of {total}. Export current list downloads all {total}.
    </p>
  )
}

function statusLabel(status: string | null) {
  if (status === "matched") return "Matched"
  if (status === "needs_confirm") return "Needs confirmation"
  if (status === "unmatched") return "Unmatched"
  return "—"
}

function gapLabel(item: CompareExportRow) {
  if (item.difference == null || item.lower == null) return "Price missing"
  if (item.lower === "same") return "Same price"
  const amount = formatMoney(Math.abs(item.difference), item.amazon_currency || item.tcg_currency)
  if (item.lower === "tcgplayer") return `${amount} lower on TCGPlayer`
  return `${amount} lower on Amazon`
}
