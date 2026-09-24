import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { ApiError, getJob, listJobs, listObservations, pauseJob, resumeJob, retryJob, stopJob } from "../api"
import { FollowUpButton, RecheckButton } from "../components/FollowUps"
import { StatusChip } from "../components/StatusChip"
import { formatMoney, paginationLabel } from "../format"
import type { Job, Observation } from "../types"

const ACTIVE = new Set(["queued", "running", "paused"])

function patternStatus(job: Job): string | null {
  const phase = job.settings.pattern_phase
  const message = job.error_message || ""
  if (phase === "related" || message.startsWith("Related items:")) {
    if (message.startsWith("Related items:")) return message
    const index = job.settings.related_index ?? 0
    const total = job.settings.related_total ?? 0
    return `Related items: card ${index}/${total}… Pause and stop still apply.`
  }
  if (phase === "recheck" || message.startsWith("Rechecking blocked list")) {
    return "Rechecking blocked list…"
  }
  return null
}

export function LiveJob({
  jobId,
  onOpenResults,
  onJob,
  onAdopt,
}: {
  jobId: number | null
  onOpenResults: (jobId: number) => void
  onJob: (job: Job) => void
  onAdopt: (jobId: number) => void
}) {
  const [job, setJob] = useState<Job | null>(null)
  const [recent, setRecent] = useState<Observation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const onJobRef = useRef(onJob)
  onJobRef.current = onJob
  const onAdoptRef = useRef(onAdopt)
  onAdoptRef.current = onAdopt

  useEffect(() => {
    if (jobId != null) return
    let cancel = false
    listJobs()
      .then((jobs) => {
        const active = jobs.find((job) => ACTIVE.has(job.status))
        if (!cancel && active) onAdoptRef.current(active.id)
      })
      .catch(() => {
        /* the main poll surfaces API errors */
      })
    return () => {
      cancel = true
    }
  }, [jobId])

  useEffect(() => {
    if (jobId == null) return
    let stop = false
    let timer = 0

    const tick = async () => {
      try {
        const next = await getJob(jobId)
        if (stop) return
        setJob(next)
        onJobRef.current(next)
        const page = await listObservations(jobId, { sort: "recent", limit: 8 })
        if (stop) return
        setRecent(page.items)
        setError(null)
        if (!stop) {
          timer = window.setTimeout(tick, ACTIVE.has(next.status) ? 1200 : 2500)
        }
      } catch (err) {
        if (stop) return
        setError(err instanceof ApiError ? err.message : "Could not load this job.")
        timer = window.setTimeout(tick, 2500)
      }
    }

    void tick()
    return () => {
      stop = true
      window.clearTimeout(timer)
    }
  }, [jobId])

  if (jobId == null) {
    return (
      <EmptyLive
        title="No scrape is running"
        body="Start one from New scrape. History keeps every finished job."
      />
    )
  }

  if (!job && !error) {
    return <p className="text-sm text-muted-foreground">Loading job {jobId}…</p>
  }

  if (!job) {
    return <p className="text-sm text-rose-800">{error}</p>
  }

  const maxPages = job.settings.max_pages || 1
  const pct =
    job.status === "completed"
      ? 100
      : Math.min(100, Math.round((job.pages_visited / maxPages) * 100))
  const active = ACTIVE.has(job.status)

  async function act(name: string, run: () => Promise<Job>) {
    setBusy(name)
    setError(null)
    try {
      const next = await run()
      setJob(next)
      onJob(next)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That action failed.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Live job</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Job {job.id}
            {job.search_query ? ` · ${job.search_query}` : ""}
          </p>
        </div>
        <StatusChip job={job} />
      </header>

      {job.status === "blocked" ? (
        <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
          <p className="font-medium">Amazon capped or blocked this session</p>
          <p className="mt-1 text-sm">{job.error_message}</p>
          {job.settings.recheck_pending ? (
            <p className="mt-2 text-sm">
              Follow-up jobs are queued. This results list is rechecked when they finish.
            </p>
          ) : null}
          {job.settings.recheck_outcome === "unchanged" ? (
            <p className="mt-2 text-sm">Still no extra page. Another slice round is the way to cover more of the catalog.</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {!job.settings.block_acknowledged ? (
              <>
                <Button size="sm" disabled={busy != null} onClick={() => act("retry", () => retryJob(job.id))}>
                  {busy === "retry" ? "Scheduling…" : "Wait & retry"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy != null}
                  onClick={() => act("stop", () => stopJob(job.id))}
                >
                  Stop & keep
                </Button>
              </>
            ) : (
              <p className="self-center text-sm">Stopped. Results kept.</p>
            )}
            <Button size="sm" variant="outline" onClick={() => onOpenResults(job.id)}>
              Open results
            </Button>
            <FollowUpButton jobId={job.id} onQueued={onAdopt} />
            <RecheckButton jobId={job.id} onQueued={onAdopt} />
          </div>
          {job.settings.related_visited ? (
            <p className="mt-2 text-sm">
              Related items were collected from {job.settings.related_visited} product card
              {job.settings.related_visited === 1 ? "" : "s"} and kept with this job.
            </p>
          ) : null}
          <p className="mt-2 text-xs text-amber-900/80">
            Related expansion gathers more products. Recheck probes pagination again and is not a guarantee Amazon will open more pages.
          </p>
        </div>
      ) : null}

      {job.status === "failed" && job.error_message ? (
        <p className="mb-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {job.error_message}
        </p>
      ) : null}

      {job.status === "completed" && job.error_message ? (
        <p className="mb-5 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
          {job.error_message}
        </p>
      ) : null}

      {job.status === "queued" && job.error_message ? (
        <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {job.error_message}
        </p>
      ) : null}

      {patternStatus(job) ? (
        <p className="mb-5 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
          {patternStatus(job)}
        </p>
      ) : null}

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            Pagination <span className="font-medium">{paginationLabel(job.pagination_mode)}</span>
          </span>
          <span className="text-muted-foreground">
            Page {job.pages_visited} of {maxPages} · {job.items_scraped} cards
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {job.pages_visited === 0 && active
            ? "Opening the first page…"
            : "Pause and stop take effect between pages."}
        </p>
        {error ? <p className="mt-3 text-sm text-rose-800">{error}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {job.status === "running" ? (
            <Button size="sm" variant="outline" disabled={busy != null} onClick={() => act("pause", () => pauseJob(job.id))}>
              {busy === "pause" ? "Pausing…" : "Pause"}
            </Button>
          ) : null}
          {job.status === "paused" ? (
            <Button size="sm" disabled={busy != null} onClick={() => act("resume", () => resumeJob(job.id))}>
              {busy === "resume" ? "Resuming…" : "Resume"}
            </Button>
          ) : null}
          {active ? (
            <Button size="sm" variant="outline" disabled={busy != null} onClick={() => act("stop", () => stopJob(job.id))}>
              {busy === "stop" ? "Stopping…" : "Stop"}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => onOpenResults(job.id)}>
            Open results
          </Button>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium">Latest cards</h2>
        {recent.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card px-4 py-6 text-sm text-muted-foreground">
            Nothing stored yet. Cards show up here as each page is saved.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {recent.map((item) => (
              <li key={item.observation_id} className="flex items-baseline justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="font-mono text-xs text-muted-foreground">{item.asin || "No ASIN"}</p>
                </div>
                <p className="shrink-0 text-sm">{formatMoney(item.price, item.currency)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function EmptyLive({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight">Live job</h1>
      <div className="mt-6 rounded-xl border border-dashed bg-card px-5 py-8">
        <h2 className="font-medium">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}
