import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, createJob, getSettings } from "../api"
import type { OperatorSettings, ProxyMode } from "../types"

const PRESETS = [
  { label: "Cards", query: "pokemon trading cards", terms: "pokemon cards" },
  { label: "Booster box", query: "pokemon booster box", terms: "pokemon cards|booster box" },
  { label: "Elite Trainer Box", query: "pokemon elite trainer box", terms: "pokemon cards|elite trainer box" },
  { label: "Tin", query: "pokemon tin", terms: "pokemon cards|tin" },
  { label: "Charizard", query: "charizard pokemon card", terms: "pokemon cards|charizard" },
]

const DEPARTMENTS = [
  { value: "all", label: "All departments" },
  { value: "toys-and-games", label: "Toys & Games" },
  { value: "stripbooks", label: "Books" },
  { value: "videogames", label: "Video Games" },
  { value: "sporting", label: "Sports" },
]

export function NewScrape({ onStarted }: { onStarted: (jobId: number) => void }) {
  const [mode, setMode] = useState<"url" | "search">("search")
  const [startUrl, setStartUrl] = useState("")
  const [query, setQuery] = useState("pokemon trading cards")
  const [terms, setTerms] = useState("pokemon cards")
  const [preset, setPreset] = useState("Cards")
  const [department, setDepartment] = useState("toys-and-games")
  const [minPrice, setMinPrice] = useState("")
  const [maxPrice, setMaxPrice] = useState("")
  const [maxPages, setMaxPages] = useState("3")
  const [delaySec, setDelaySec] = useState("2.5")
  const [browser, setBrowser] = useState<OperatorSettings | null>(null)
  const [proxyMode, setProxyMode] = useState<ProxyMode>("default")
  const [proxyUrl, setProxyUrl] = useState("")
  const [proxyUsername, setProxyUsername] = useState("")
  const [proxyPassword, setProxyPassword] = useState("")
  const [expandRelated, setExpandRelated] = useState(true)
  const [relatedLimit, setRelatedLimit] = useState("3")
  const [recheckAfter, setRecheckAfter] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<"live" | "fixture" | null>(null)

  useEffect(() => {
    let cancel = false
    getSettings()
      .then((settings) => {
        if (cancel) return
        setBrowser(settings)
        setMaxPages(String(settings.max_pages))
        setDelaySec(String(settings.delay_sec))
        setExpandRelated(settings.expand_related)
        setRelatedLimit(String(settings.related_cards_limit))
        setRecheckAfter(settings.recheck_after_block)
      })
      .catch(() => {
        if (!cancel) setBrowser(null)
      })
    return () => {
      cancel = true
    }
  }, [])

  function applyPreset(next: (typeof PRESETS)[number]) {
    setPreset(next.label)
    setQuery(next.query)
    setTerms(next.terms)
  }

  async function startLive(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const pages = Number(maxPages)
    const delay = Number(delaySec)
    if (!Number.isInteger(pages) || pages < 1) {
      setError("Max pages must be a whole number of at least 1.")
      return
    }
    if (!Number.isFinite(delay) || delay < 1 || delay > 60) {
      setError("Delay must be between 1 and 60 seconds.")
      return
    }
    if (mode === "url" && !startUrl.trim()) {
      setError("Paste an Amazon results URL.")
      return
    }
    if (mode === "search" && !query.trim()) {
      setError("Enter a search keyword.")
      return
    }
    const min = minPrice.trim() === "" ? null : Number(minPrice)
    const max = maxPrice.trim() === "" ? null : Number(maxPrice)
    if ((min != null && !Number.isFinite(min)) || (max != null && !Number.isFinite(max))) {
      setError("Prices need to be numbers.")
      return
    }
    const cards = Number(relatedLimit)
    if (!Number.isInteger(cards) || cards < 1 || cards > 20) {
      setError("Related cards must be a whole number from 1 to 20.")
      return
    }
    setPending("live")
    try {
      const job = await createJob({
        mode,
        start_url: mode === "url" ? startUrl.trim() : undefined,
        search_query: mode === "search" ? query.trim() : undefined,
        search_terms: mode === "search" ? terms : undefined,
        department: mode === "search" ? department : undefined,
        min_price: mode === "search" ? min : undefined,
        max_price: mode === "search" ? max : undefined,
        max_pages: pages,
        delay_sec: delay,
        proxy_mode: proxyMode,
        proxy_url: proxyMode === "custom" ? proxyUrl.trim() : undefined,
        proxy_username: proxyMode === "custom" ? proxyUsername.trim() : undefined,
        proxy_password: proxyMode === "custom" ? proxyPassword : undefined,
        expand_related: expandRelated,
        related_cards_limit: cards,
        recheck_after_block: recheckAfter,
      })
      onStarted(job.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the scrape.")
    } finally {
      setPending(null)
    }
  }

  async function startFixture() {
    setError(null)
    setPending("fixture")
    try {
      const job = await createJob({
        mode: "fixture",
        fixture_set: "pokemon",
        search_query: "Pokemon cards",
        search_terms: "pokemon cards|fixture",
        max_pages: 5,
        delay_sec: 3,
        expand_related: expandRelated,
        related_cards_limit: Number(relatedLimit) || 3,
        recheck_after_block: recheckAfter,
      })
      onStarted(job.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Fixture dry-run failed.")
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,640px)_260px]">
      <div>
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">New scrape</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Paste an Amazon results URL, or start from a Pokemon search. Cards land in the local ledger.
          </p>
        </header>
        <form onSubmit={startLive} className="space-y-5 rounded-xl border bg-card p-5 shadow-sm">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Source</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <ModeCard
                name="source"
                checked={mode === "url"}
                onChange={() => setMode("url")}
                title="Amazon URL"
                detail="Search or category page"
              />
              <ModeCard
                name="source"
                checked={mode === "search"}
                onChange={() => setMode("search")}
                title="Pokemon search"
                detail="Keyword and light filters"
              />
            </div>
          </fieldset>

          {mode === "url" ? (
            <div className="space-y-2">
              <Label htmlFor="start-url">Results URL</Label>
              <Input
                id="start-url"
                value={startUrl}
                onChange={(event) => setStartUrl(event.target.value)}
                placeholder="https://www.amazon.com/s?k=pokemon+cards"
                autoComplete="off"
                className="h-10"
              />
              <p className="text-xs text-muted-foreground">
                A single product link will be rejected. Use the results page.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="keyword">Keyword</Label>
                <Input
                  id="keyword"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setTerms(event.target.value.trim())
                    setPreset("")
                  }}
                  className="h-10"
                />
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((item) => (
                    <Button
                      key={item.label}
                      type="button"
                      size="sm"
                      variant={preset === item.label ? "default" : "outline"}
                      onClick={() => applyPreset(item)}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-2 sm:col-span-1">
                  <Label htmlFor="department">Department</Label>
                  <select
                    id="department"
                    value={department}
                    onChange={(event) => setDepartment(event.target.value)}
                    className="h-10 w-full rounded-lg border border-input bg-card px-2.5 text-sm"
                  >
                    {DEPARTMENTS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="min-price">Min price</Label>
                  <Input
                    id="min-price"
                    inputMode="decimal"
                    value={minPrice}
                    onChange={(event) => setMinPrice(event.target.value)}
                    placeholder="0"
                    className="h-10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-price">Max price</Label>
                  <Input
                    id="max-price"
                    inputMode="decimal"
                    value={maxPrice}
                    onChange={(event) => setMaxPrice(event.target.value)}
                    placeholder="Any"
                    className="h-10"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="max-pages">Max pages</Label>
              <Input
                id="max-pages"
                type="number"
                min={1}
                value={maxPages}
                onChange={(event) => setMaxPages(event.target.value)}
                className="h-10"
              />
              <p className="text-xs text-muted-foreground">
                Any whole number from 1 up. The crawl still stops when the list ends or Amazon blocks.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="delay">Delay (seconds)</Label>
              <Input
                id="delay"
                type="number"
                min={1}
                max={60}
                step={0.5}
                value={delaySec}
                onChange={(event) => setDelaySec(event.target.value)}
                className="h-10"
              />
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Proxy</legend>
            <label className="flex items-start gap-3 rounded-lg border p-3">
              <input
                type="radio"
                name="proxy"
                checked={proxyMode === "default"}
                onChange={() => setProxyMode("default")}
                className="mt-1 accent-[#9a3412]"
              />
              <span>
                <span className="block text-sm font-medium">Use settings default</span>
                <span className="block text-xs text-muted-foreground">
                  {browser?.proxy_enabled && browser.proxy_url
                    ? `On · ${browser.proxy_url}`
                    : "No proxy saved in Settings."}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-lg border p-3">
              <input
                type="radio"
                name="proxy"
                checked={proxyMode === "off"}
                onChange={() => setProxyMode("off")}
                className="mt-1 accent-[#9a3412]"
              />
              <span>
                <span className="block text-sm font-medium">No proxy</span>
                <span className="block text-xs text-muted-foreground">This job connects directly.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-lg border p-3">
              <input
                type="radio"
                name="proxy"
                checked={proxyMode === "custom"}
                onChange={() => setProxyMode("custom")}
                className="mt-1 accent-[#9a3412]"
              />
              <span>
                <span className="block text-sm font-medium">Custom proxy</span>
                <span className="block text-xs text-muted-foreground">Override for this job only.</span>
              </span>
            </label>
            {proxyMode === "custom" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="job-proxy-url">Proxy URL</Label>
                  <Input
                    id="job-proxy-url"
                    value={proxyUrl}
                    onChange={(event) => setProxyUrl(event.target.value)}
                    placeholder="http://127.0.0.1:8888"
                    autoComplete="off"
                    className="h-10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="job-proxy-user">Username</Label>
                  <Input
                    id="job-proxy-user"
                    value={proxyUsername}
                    onChange={(event) => setProxyUsername(event.target.value)}
                    autoComplete="off"
                    className="h-10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="job-proxy-pass">Password</Label>
                  <Input
                    id="job-proxy-pass"
                    type="password"
                    value={proxyPassword}
                    onChange={(event) => setProxyPassword(event.target.value)}
                    autoComplete="new-password"
                    className="h-10"
                  />
                </div>
              </div>
            ) : null}
          </fieldset>
          <fieldset className="space-y-3 border-t pt-4">
            <legend className="text-sm font-medium">Blocked recovery pattern</legend>
            <div className="rounded-lg border p-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={expandRelated}
                  onChange={(event) => setExpandRelated(event.target.checked)}
                  className="mt-1 accent-[#9a3412]"
                />
                <span className="text-sm font-medium">On block: scrape related items from early cards</span>
              </label>
              <div className="mt-3 space-y-2 pl-7">
                <Label htmlFor="related-limit">Cards to open (N)</Label>
                <Input
                  id="related-limit"
                  type="number"
                  min={1}
                  max={20}
                  value={relatedLimit}
                  onChange={(event) => setRelatedLimit(event.target.value)}
                  className="h-10 w-24"
                />
              </div>
            </div>
            <label className="flex items-start gap-3 rounded-lg border p-3">
              <input
                type="checkbox"
                checked={recheckAfter}
                onChange={(event) => setRecheckAfter(event.target.checked)}
                className="mt-1 accent-[#9a3412]"
              />
              <span>
                <span className="block text-sm font-medium">Then recheck for more pages</span>
                <span className="block text-xs text-muted-foreground">
                  After related expansion, or immediately if that step is off.
                </span>
              </span>
            </label>
            <p className="text-xs text-muted-foreground">
              Related expansion gathers more products from early result cards. Recheck probes pagination again. Neither step guarantees Amazon will open more pages.
            </p>
          </fieldset>
          <p className="text-xs text-muted-foreground">
            Browser: {browser ? (browser.headless ? "headless" : "headed") : "…"}. Change that in Settings. Live scrapes wait at least 1 second between pages. Dry-runs ignore the proxy.
          </p>
          {error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" disabled={pending != null}>
              {pending === "live" ? "Starting…" : "Start scrape"}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={pending != null}
              onClick={startFixture}
            >
              {pending === "fixture" ? "Starting…" : "Dry-run with sample HTML"}
            </Button>
          </div>
        </form>
      </div>
      <aside className="h-fit rounded-xl border bg-card p-5 text-sm shadow-sm lg:mt-16">
        <h2 className="font-medium">What this does</h2>
        <p className="mt-2 text-muted-foreground">
          Opens the results page, reads each product card, then follows Next or Show more until the list ends or your page cap. Pause and stop keep what was already stored.
        </p>
        <p className="mt-3 text-muted-foreground">
          If Amazon soft-blocks or caps pagination, the job can collect related items from the first cards, then look at the results list again. That gathers more products. It does not try to evade the check.
        </p>
        <p className="mt-3 text-muted-foreground">
          The dry-run uses saved HTML so you can see Live job, Results, and History without calling Amazon.
        </p>
      </aside>
    </div>
  )
}

function ModeCard({
  name,
  checked,
  onChange,
  title,
  detail,
}: {
  name: string
  checked: boolean
  onChange: () => void
  title: string
  detail: string
}) {
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${
        checked ? "border-primary bg-primary/5" : "hover:bg-muted/60"
      }`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="mt-1 accent-[#9a3412]"
      />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </label>
  )
}
