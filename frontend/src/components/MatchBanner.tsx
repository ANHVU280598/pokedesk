import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { ApiError, getJob, stopJob } from "../api"
import type { Job } from "../types"

const ACTIVE = new Set(["queued", "running", "paused"])

export function MatchBanner({
  jobId,
  onTick,
  onFinished,
}: {
  jobId: number | null
  onTick: () => void
  onFinished: (job: Job) => void
}) {
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const onTickRef = useRef(onTick)
  const onFinishedRef = useRef(onFinished)
  onTickRef.current = onTick
  onFinishedRef.current = onFinished

  useEffect(() => {
    if (jobId == null) {
      setJob(null)
      setError(null)
      return
    }
    let stop = false
    let timer = 0
    const tick = async () => {
      try {
        const next = await getJob(jobId)
        if (stop) return
        setJob(next)
        setError(null)
        onTickRef.current()
        if (!ACTIVE.has(next.status)) {
          onFinishedRef.current(next)
          return
        }
        timer = window.setTimeout(tick, 700)
      } catch (err) {
        if (stop) return
        setError(err instanceof ApiError ? err.message : "Could not read the match.")
        timer = window.setTimeout(tick, 1500)
      }
    }
    void tick()
    return () => {
      stop = true
      window.clearTimeout(timer)
    }
  }, [jobId])

  if (jobId == null) return null

  const message = job?.error_message || "Starting the TCGPlayer match…"
  const failed = job?.status === "failed"

  async function cancel() {
    if (jobId == null) return
    setStopping(true)
    setError(null)
    try {
      await stopJob(jobId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel the match.")
    } finally {
      setStopping(false)
    }
  }

  return (
    <div
      className={
        failed
          ? "mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900"
          : "mb-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{message}</p>
        {job && ACTIVE.has(job.status) ? (
          <Button type="button" size="sm" variant="outline" disabled={stopping} onClick={() => void cancel()}>
            {stopping ? "Cancelling…" : "Cancel"}
          </Button>
        ) : null}
      </div>
      {error ? <p className="mt-1 text-rose-800">{error}</p> : null}
    </div>
  )
}
