import { Badge } from "@/components/ui/badge"
import { stoppedByOperator } from "../format"
import type { Job } from "../types"

const TONE: Record<string, string> = {
  queued: "bg-stone-200 text-stone-800",
  running: "bg-sky-100 text-sky-950",
  paused: "bg-amber-100 text-amber-950",
  completed: "bg-emerald-100 text-emerald-950",
  failed: "bg-rose-100 text-rose-950",
  blocked: "bg-amber-200 text-amber-950",
  stopped: "bg-stone-200 text-stone-800",
}

export function statusText(job: Pick<Job, "status" | "error_message" | "settings">) {
  if (stoppedByOperator(job as Job)) return "Stopped"
  return job.status.slice(0, 1).toUpperCase() + job.status.slice(1)
}

export function StatusChip({
  job,
}: {
  job: Pick<Job, "status" | "error_message" | "settings">
}) {
  const label = statusText(job)
  const tone = stoppedByOperator(job as Job) ? TONE.stopped : TONE[job.status]
  return (
    <Badge
      variant="secondary"
      className={`h-6 rounded-full px-2.5 font-medium ${tone}`}
      title={job.error_message || undefined}
    >
      {label}
    </Badge>
  )
}
