import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { ApiError, createJob, listJobs } from "../api"
import { FollowUpButton, RecheckButton } from "../components/FollowUps"
import { StatusChip } from "../components/StatusChip"
import { formatWhen, jobMode, sourceLabel } from "../format"
import type { Job } from "../types"

export function History({
  onView,
  onStarted,
}: {
  onView: (jobId: number) => void
  onStarted: (jobId: number) => void
}) {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => {
    let cancel = false
    listJobs()
      .then((rows) => {
        if (!cancel) setJobs(rows)
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof ApiError ? err.message : "Could not load history.")
      })
    return () => {
      cancel = true
    }
  }, [])

  async function rerun(job: Job) {
    setBusyId(job.id)
    setError(null)
    const mode = jobMode(job)
    try {
      const created = await createJob({
        mode,
        start_url: mode === "url" ? job.start_url || undefined : undefined,
        search_query: job.search_query || undefined,
        search_terms: job.search_terms,
        min_price: job.settings.min_price,
        max_price: job.settings.max_price,
        department: job.settings.department || undefined,
        max_pages: job.settings.max_pages,
        delay_sec: (job.settings.delay_ms ?? 2500) / 1000,
        headless: job.settings.headless,
        fixture_set: job.settings.fixture_set || undefined,
        expand_related: job.settings.expand_related,
        related_cards_limit: job.settings.related_cards_limit,
        recheck_after_block: job.settings.recheck_after_block,
      })
      onStarted(created.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Re-run failed.")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">History</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every scrape kept in this SQLite file. Re-run copies that job’s limits.
        </p>
      </header>
      {error ? (
        <p className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
      ) : null}
      {jobs == null ? (
        <p className="text-sm text-muted-foreground">Loading history…</p>
      ) : jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card px-5 py-10 text-sm text-muted-foreground">
          No scrapes yet. Run one from New scrape.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Pages</th>
                <th className="px-3 py-2 font-medium">Cards</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{formatWhen(job.started_at || job.created_at)}</td>
                  <td className="max-w-[280px] truncate px-3 py-2" title={job.start_url || undefined}>
                    {sourceLabel(job)}
                    {job.parent_job_id ? (
                      <div className="text-xs text-muted-foreground">Follow-up of #{job.parent_job_id}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <StatusChip job={job} />
                    {job.settings.recheck_outcome === "advanced" ? (
                      <div className="mt-1 text-xs text-muted-foreground">More pages found on recheck</div>
                    ) : null}
                    {job.settings.recheck_outcome === "unchanged" ? (
                      <div className="mt-1 text-xs text-muted-foreground">Still capped — try another slice</div>
                    ) : null}
                    {job.settings.recheck_pending ? (
                      <div className="mt-1 text-xs text-muted-foreground">Recheck after follow-ups</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{job.pages_visited}</td>
                  <td className="px-3 py-2">{job.items_scraped}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => onView(job.id)}>
                        View
                      </Button>
                      <Button size="sm" variant="outline" disabled={busyId === job.id} onClick={() => rerun(job)}>
                        {busyId === job.id ? "Starting…" : "Re-run"}
                      </Button>
                      {job.status === "blocked" ? (
                        <>
                          <FollowUpButton jobId={job.id} onQueued={onStarted} />
                          <RecheckButton jobId={job.id} onQueued={onStarted} />
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
