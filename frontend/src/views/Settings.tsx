import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, getSettings, putSettings } from "../api"

export function Settings() {
  const [delaySec, setDelaySec] = useState("2.5")
  const [maxPages, setMaxPages] = useState("3")
  const [headless, setHeadless] = useState(true)
  const [proxyEnabled, setProxyEnabled] = useState(false)
  const [proxyUrl, setProxyUrl] = useState("")
  const [proxyUsername, setProxyUsername] = useState("")
  const [proxyPassword, setProxyPassword] = useState("")
  const [passwordSet, setPasswordSet] = useState(false)
  const [clearPassword, setClearPassword] = useState(false)
  const [expandRelated, setExpandRelated] = useState(true)
  const [relatedLimit, setRelatedLimit] = useState("3")
  const [recheckAfter, setRecheckAfter] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let cancel = false
    getSettings()
      .then((settings) => {
        if (cancel) return
        setDelaySec(String(settings.delay_sec))
        setMaxPages(String(settings.max_pages))
        setHeadless(settings.headless)
        setProxyEnabled(settings.proxy_enabled)
        setProxyUrl(settings.proxy_url || "")
        setProxyUsername(settings.proxy_username || "")
        setPasswordSet(settings.proxy_password_set)
        setProxyPassword("")
        setClearPassword(false)
        setExpandRelated(settings.expand_related)
        setRelatedLimit(String(settings.related_cards_limit))
        setRecheckAfter(settings.recheck_after_block)
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof ApiError ? err.message : "Could not load settings.")
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaved(false)
    const delay = Number(delaySec)
    const pages = Number(maxPages)
    if (!Number.isFinite(delay) || delay < 1 || delay > 60) {
      setError("Default delay must be between 1 and 60 seconds.")
      return
    }
    if (!Number.isInteger(pages) || pages < 1 || pages > 20) {
      setError("Default max pages must be a whole number from 1 to 20.")
      return
    }
    const cards = Number(relatedLimit)
    if (!Number.isInteger(cards) || cards < 1 || cards > 20) {
      setError("Related cards must be a whole number from 1 to 20.")
      return
    }
    setPending(true)
    setError(null)
    try {
      const next = await putSettings({
        delay_sec: delay,
        max_pages: pages,
        headless,
        proxy_enabled: proxyEnabled,
        proxy_url: proxyUrl.trim(),
        proxy_username: proxyUsername.trim(),
        proxy_password: proxyPassword,
        clear_proxy_password: clearPassword,
        expand_related: expandRelated,
        related_cards_limit: cards,
        recheck_after_block: recheckAfter,
      })
      setDelaySec(String(next.delay_sec))
      setMaxPages(String(next.max_pages))
      setHeadless(next.headless)
      setProxyEnabled(next.proxy_enabled)
      setProxyUrl(next.proxy_url || "")
      setProxyUsername(next.proxy_username || "")
      setPasswordSet(next.proxy_password_set)
      setProxyPassword("")
      setClearPassword(false)
      setExpandRelated(next.expand_related)
      setRelatedLimit(String(next.related_cards_limit))
      setRecheckAfter(next.recheck_after_block)
      setSaved(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save settings.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Defaults for the next scrape. A job already running keeps the settings it started with.
        </p>
      </header>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading settings…</p>
      ) : (
        <form onSubmit={save} className="space-y-5 rounded-xl border bg-card p-5 shadow-sm">
          <div className="space-y-2">
            <Label htmlFor="default-delay">Default delay (seconds)</Label>
            <Input
              id="default-delay"
              type="number"
              min={1}
              max={60}
              step={0.5}
              value={delaySec}
              onChange={(event) => setDelaySec(event.target.value)}
              className="h-10"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="default-pages">Default max pages</Label>
            <Input
              id="default-pages"
              type="number"
              min={1}
              max={20}
              value={maxPages}
              onChange={(event) => setMaxPages(event.target.value)}
              className="h-10"
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Browser</legend>
            <label className="flex items-start gap-3 rounded-lg border p-3">
              <input
                type="radio"
                name="browser"
                checked={headless}
                onChange={() => setHeadless(true)}
                className="mt-1 accent-[#9a3412]"
              />
              <span>
                <span className="block text-sm font-medium">Headless</span>
                <span className="block text-xs text-muted-foreground">
                  Chromium stays in the background. This is the usual choice.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-lg border p-3">
              <input
                type="radio"
                name="browser"
                checked={!headless}
                onChange={() => setHeadless(false)}
                className="mt-1 accent-[#9a3412]"
              />
              <span>
                <span className="block text-sm font-medium">Headed</span>
                <span className="block text-xs text-muted-foreground">
                  Opens a visible window. Needs a local display.
                </span>
              </span>
            </label>
          </fieldset>
          <fieldset className="space-y-3 border-t pt-4">
            <legend className="text-sm font-medium">Blocked recovery pattern</legend>
            <p className="text-xs text-muted-foreground">
              Related expansion gathers more products from early result cards. Recheck probes pagination again. Neither step guarantees Amazon will open more pages.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={expandRelated}
                onChange={(event) => setExpandRelated(event.target.checked)}
                className="accent-[#9a3412]"
              />
              On block: scrape related items
            </label>
            <div className="space-y-2">
              <Label htmlFor="default-related">Default cards to open (N)</Label>
              <Input
                id="default-related"
                type="number"
                min={1}
                max={20}
                value={relatedLimit}
                onChange={(event) => setRelatedLimit(event.target.value)}
                className="h-10 w-24"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={recheckAfter}
                onChange={(event) => setRecheckAfter(event.target.checked)}
                className="accent-[#9a3412]"
              />
              Then recheck for more pages
            </label>
          </fieldset>
          <fieldset className="space-y-3 border-t pt-4">
            <legend className="text-sm font-medium">Proxy</legend>
            <p className="text-xs text-muted-foreground">
              Used for live Playwright scrapes only. Dry-runs stay on this machine. The password is stored in the local settings file and is not shown again after you save.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={proxyEnabled}
                onChange={(event) => setProxyEnabled(event.target.checked)}
                className="accent-[#9a3412]"
              />
              Enable proxy
            </label>
            <div className="space-y-2">
              <Label htmlFor="proxy-url">Proxy URL</Label>
              <Input
                id="proxy-url"
                value={proxyUrl}
                onChange={(event) => setProxyUrl(event.target.value)}
                placeholder="http://127.0.0.1:8888 or socks5://host:1080"
                autoComplete="off"
                className="h-10"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="proxy-user">Username</Label>
                <Input
                  id="proxy-user"
                  value={proxyUsername}
                  onChange={(event) => setProxyUsername(event.target.value)}
                  autoComplete="off"
                  className="h-10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="proxy-pass">Password</Label>
                <Input
                  id="proxy-pass"
                  type="password"
                  value={proxyPassword}
                  onChange={(event) => setProxyPassword(event.target.value)}
                  placeholder={passwordSet ? "Saved — leave blank to keep" : "Optional"}
                  autoComplete="new-password"
                  className="h-10"
                />
              </div>
            </div>
            {passwordSet ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={clearPassword}
                  onChange={(event) => setClearPassword(event.target.checked)}
                  className="accent-[#9a3412]"
                />
                Clear saved password
              </label>
            ) : null}
          </fieldset>
          {error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900" role="alert">
              {error}
            </p>
          ) : null}
          {saved ? <p className="text-sm text-emerald-800">Saved. The next scrape picks these up.</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save defaults"}
          </Button>
        </form>
      )}
    </div>
  )
}
