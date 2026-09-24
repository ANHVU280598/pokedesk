import { useEffect, useState } from "react"
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
import { ApiError, clearProductTcgMatch, setProductTcgUrl } from "../api"
import type { Product } from "../types"

export function SetTcgUrl({
  productId,
  manual,
  onClose,
  onSaved,
}: {
  productId: number | null
  manual: boolean
  onClose: () => void
  onSaved: (product: Product) => void
}) {
  const [url, setUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    setUrl("")
    setError(null)
    setPending(false)
  }, [productId])

  async function save() {
    if (productId == null) return
    setPending(true)
    setError(null)
    try {
      const product = await setProductTcgUrl(productId, url.trim())
      onSaved(product)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not scrape that TCGPlayer page.")
    } finally {
      setPending(false)
    }
  }

  async function clearMatch() {
    if (productId == null) return
    setPending(true)
    setError(null)
    try {
      const product = await clearProductTcgMatch(productId)
      onSaved(product)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not clear the match.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Sheet open={productId != null} onOpenChange={(open) => !open && !pending && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Set TCGPlayer URL</SheetTitle>
          <SheetDescription>
            Paste the TCGPlayer product page for this Amazon card. Catalog Desk scrapes that page and stores it as a manual match. Batch matching will not replace it.
          </SheetDescription>
        </SheetHeader>
        <form
          className="space-y-3 px-4 pb-6"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          {error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="tcg-product-url">TCGPlayer product URL</Label>
            <Input
              id="tcg-product-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.tcgplayer.com/product/123456/card-name"
              disabled={pending}
              className="h-10"
            />
          </div>
          {pending ? <p className="text-sm text-sky-950">Scraping that TCGPlayer page…</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={pending || url.trim() === ""}>
              {pending ? "Scraping…" : "Scrape and link"}
            </Button>
            {manual ? (
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void clearMatch()}>
                Clear match
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            A manual match stays until you clear it or paste a different product URL. Re-match all does not overwrite it.
          </p>
        </form>
      </SheetContent>
    </Sheet>
  )
}
