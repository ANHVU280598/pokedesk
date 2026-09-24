import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ApiError, confirmTcgCandidate, getProduct } from "../api"
import { formatMoney } from "../format"
import type { TcgCandidate } from "../types"

export function ConfirmTcg({
  productId,
  onClose,
  onConfirmed,
}: {
  productId: number | null
  onClose: () => void
  onConfirmed: (productId: number) => void
}) {
  const [title, setTitle] = useState("")
  const [candidates, setCandidates] = useState<TcgCandidate[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (productId == null) {
      setCandidates([])
      setSelected(null)
      return
    }
    let cancel = false
    setError(null)
    getProduct(productId)
      .then((product) => {
        if (cancel) return
        setTitle(product.title)
        const rows = product.tcg_candidates || []
        setCandidates(rows)
        const current = rows.find((item) => item.url === product.tcg_url)
        setSelected(current?.id ?? rows[0]?.id ?? null)
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof ApiError ? err.message : "Could not load listings.")
      })
    return () => {
      cancel = true
    }
  }, [productId])

  async function confirm() {
    if (productId == null || selected == null) return
    setPending(true)
    setError(null)
    try {
      await confirmTcgCandidate(productId, selected)
      onConfirmed(productId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not confirm that listing.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Sheet open={productId != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Choose the TCGPlayer listing</SheetTitle>
          <SheetDescription>
            {title || "This Amazon product"} matched more than one plausible card. The product stays unconfirmed until you pick one.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4 pb-6">
          {error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
          ) : null}
          {productId != null && candidates.length === 0 && !error ? (
            <p className="text-sm text-muted-foreground">Loading listings…</p>
          ) : null}
          <fieldset className="space-y-2">
            {candidates.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer gap-3 rounded-lg border p-3 has-[:checked]:border-primary"
              >
                <input
                  type="radio"
                  name="tcg-candidate"
                  className="mt-1"
                  checked={selected === item.id}
                  onChange={() => setSelected(item.id)}
                />
                <span className="min-w-0">
                  <span className="block font-medium">{item.name}</span>
                  {item.set_name ? (
                    <span className="block text-xs text-muted-foreground">{item.set_name}</span>
                  ) : null}
                  <span className="block text-sm">
                    {item.price == null
                      ? "No price shown"
                      : `${item.price_label ? `${item.price_label} ` : ""}${formatMoney(item.price, item.currency)}`}
                  </span>
                  {item.prices.length > 1 ? (
                    <span className="block text-xs text-muted-foreground">
                      {item.prices
                        .map((price) => `${price.label} ${formatMoney(price.amount, item.currency)}`)
                        .join(" · ")}
                    </span>
                  ) : null}
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary underline"
                  >
                    Open on TCGPlayer
                  </a>
                </span>
              </label>
            ))}
          </fieldset>
          <Button type="button" disabled={pending || selected == null} onClick={() => void confirm()}>
            {pending ? "Saving…" : "Confirm listing"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
