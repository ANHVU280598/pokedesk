import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, createManualMatch } from "../api"

export function ManualMatch({ onCompare }: { onCompare: (productId: number) => void }) {
  const [amazonUrl, setAmazonUrl] = useState("")
  const [tcgUrl, setTcgUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const product = await createManualMatch(amazonUrl.trim(), tcgUrl.trim())
      onCompare(product.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not scrape those pages.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Manual match</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          When you already know the TCGPlayer page for an Amazon listing, paste both URLs. Catalog Desk scrapes each page, keeps the Amazon price as a new snapshot, and links them as a manual match.
        </p>
      </header>
      <form
        className="space-y-4 rounded-xl border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {error ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="manual-amazon">Amazon product URL</Label>
          <Input
            id="manual-amazon"
            value={amazonUrl}
            onChange={(event) => setAmazonUrl(event.target.value)}
            placeholder="https://www.amazon.com/dp/B0PKMN0001"
            disabled={pending}
            className="h-10"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="manual-tcg">TCGPlayer product URL</Label>
          <Input
            id="manual-tcg"
            value={tcgUrl}
            onChange={(event) => setTcgUrl(event.target.value)}
            placeholder="https://www.tcgplayer.com/product/123456/card-name"
            disabled={pending}
            className="h-10"
          />
        </div>
        {pending ? (
          <p className="text-sm text-sky-950">Scraping the Amazon page, then the TCGPlayer page…</p>
        ) : null}
        <Button type="submit" disabled={pending || amazonUrl.trim() === "" || tcgUrl.trim() === ""}>
          {pending ? "Scraping…" : "Scrape and compare"}
        </Button>
        <p className="text-xs text-muted-foreground">
          If the ASIN is already in the catalog, its title and price are refreshed and older prices stay. A manual link is not replaced by Match on TCGPlayer or Re-match all. Clear the match on the product to remove it.
        </p>
      </form>
    </div>
  )
}
