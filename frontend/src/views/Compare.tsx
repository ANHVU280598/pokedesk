import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { ExportGroup } from "../components/ExportMenu"
import { ApiError, getCompare } from "../api"
import { formatBought, formatMoney } from "../format"
import type { PriceCompare } from "../types"

export function Compare({
  productId,
  onBack,
}: {
  productId: number | null
  onBack: () => void
}) {
  const [page, setPage] = useState<PriceCompare | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (productId == null) return
    let cancel = false
    setPage(null)
    setError(null)
    getCompare(productId)
      .then((next) => {
        if (!cancel) setPage(next)
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof ApiError ? err.message : "Could not load this comparison.")
      })
    return () => {
      cancel = true
    }
  }, [productId])

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compare prices</h1>
          <p className="mt-1 text-sm text-muted-foreground">Amazon listing beside the confirmed TCGPlayer card.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportGroup
            label="Export this comparison"
            dataset="price-compare"
            params={{ product_id: productId }}
            disabled={productId == null}
          />
          <Button type="button" variant="outline" size="sm" onClick={onBack}>
            Back
          </Button>
        </div>
      </header>
      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
      ) : null}
      {page == null && !error ? <p className="text-sm text-muted-foreground">Loading the pair…</p> : null}
      {page ? (
        <>
          <p className="mb-4 text-sm font-medium">{summary(page)}</p>
          {page.match_source === "manual" ? (
            <p className="mb-4 text-sm text-muted-foreground">Manual match. Batch matching will not replace this link.</p>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <Side
              source="Amazon"
              title={page.amazon.title}
              image={page.amazon.image_url}
              meta={page.amazon.asin ? `ASIN ${page.amazon.asin}` : null}
              price={formatMoney(page.amazon.price, page.amazon.currency)}
              extra={
                page.amazon.bought_past_month != null || page.amazon.bought_past_month_text
                  ? `Bought last month ${formatBought(page.amazon.bought_past_month, page.amazon.bought_past_month_text)}`
                  : null
              }
              href={page.amazon.url}
              linkLabel="Open on Amazon"
            />
            <Side
              source="TCGPlayer"
              title={page.tcg?.name || "Confirmed listing"}
              image={page.tcg?.image_url ?? null}
              meta={page.tcg?.set_name ?? null}
              price={
                page.tcg?.price == null
                  ? "—"
                  : `${page.tcg.price_label ? `${page.tcg.price_label} ` : ""}${formatMoney(page.tcg.price, page.tcg.currency)}`
              }
              extra={
                page.tcg && page.tcg.prices.length > 1
                  ? page.tcg.prices
                      .map((item) => `${item.label} ${formatMoney(item.amount, page.tcg?.currency ?? "USD")}`)
                      .join(" · ")
                  : null
              }
              href={page.tcg?.url ?? null}
              linkLabel="Open on TCGPlayer"
            />
          </div>
        </>
      ) : null}
    </div>
  )
}

function summary(page: PriceCompare) {
  if (page.lower === "same") return "Amazon and TCGPlayer show the same price."
  if (page.difference == null || page.lower == null) return "One side has no price to compare."
  const gap = formatMoney(Math.abs(page.difference), page.amazon.currency || page.tcg?.currency || "USD")
  if (page.lower === "tcgplayer") return `TCGPlayer is ${gap} lower.`
  return `Amazon is ${gap} lower.`
}

function Side({
  source,
  title,
  image,
  meta,
  price,
  extra,
  href,
  linkLabel,
}: {
  source: string
  title: string
  image: string | null
  meta: string | null
  price: string
  extra: string | null
  href: string | null
  linkLabel: string
}) {
  return (
    <article className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{source}</p>
      <div className="mt-3 flex gap-3">
        {image ? (
          <img src={image} alt="" className="size-20 shrink-0 rounded bg-muted object-contain" />
        ) : (
          <div className="size-20 shrink-0 rounded bg-muted" />
        )}
        <div className="min-w-0">
          <h2 className="text-base font-medium leading-snug">{title}</h2>
          {meta ? <p className="mt-1 text-xs text-muted-foreground">{meta}</p> : null}
        </div>
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-tight">{price}</p>
      {extra ? <p className="mt-1 text-sm text-muted-foreground">{extra}</p> : null}
      {href ? (
        <Button asChild className="mt-4" variant="outline" size="sm">
          <a href={href} target="_blank" rel="noreferrer">
            {linkLabel}
          </a>
        </Button>
      ) : null}
    </article>
  )
}
