import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ApiError, createFollowUps, listFollowUps, recheckJob } from "../api"
import type { FollowUpSuggestion } from "../types"

export function FollowUpButton({
  jobId,
  onQueued,
}: {
  jobId: number
  onQueued: (jobId: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<FollowUpSuggestion[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancel = false
    setSuggestions(null)
    setError(null)
    listFollowUps(jobId)
      .then((page) => {
        if (cancel) return
        setSuggestions(page.suggestions)
        setSelected(page.suggestions.map((item) => item.id))
      })
      .catch((err: unknown) => {
        if (!cancel) {
          setError(err instanceof ApiError ? err.message : "Could not load follow-ups.")
          setSuggestions([])
        }
      })
    return () => {
      cancel = true
    }
  }, [open, jobId])

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  async function queue() {
    if (selected.length === 0) {
      setError("Select at least one follow-up.")
      return
    }
    setPending(true)
    setError(null)
    try {
      const created = await createFollowUps(jobId, selected)
      setOpen(false)
      if (created.jobs[0]) onQueued(created.jobs[0].id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not queue follow-ups.")
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Create follow-up jobs
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Follow-up jobs</SheetTitle>
            <SheetDescription>
              These slice the same search by price, sort, or a narrower Pokemon keyword so pagination starts over. After they finish, the blocked job is rechecked for another page. Nothing here tries to get around Amazon’s check.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4 pb-6">
            {suggestions == null ? (
              <p className="text-sm text-muted-foreground">Loading suggestions…</p>
            ) : suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No extra slices for this search. The keyword or URL was already too narrow to split.
              </p>
            ) : (
              suggestions.map((item) => (
                <label
                  key={item.id}
                  className="flex cursor-pointer gap-3 rounded-lg border p-3"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    onChange={() => toggle(item.id)}
                    className="mt-1 accent-[#9a3412]"
                  />
                  <span>
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{item.detail}</span>
                  </span>
                </label>
              ))
            )}
            {error ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="button" disabled={pending || !suggestions?.length} onClick={() => void queue()}>
              {pending ? "Queuing…" : `Queue ${selected.length} selected`}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export function RecheckButton({
  jobId,
  onQueued,
}: {
  jobId: number
  onQueued: (jobId: number) => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function recheck() {
    setPending(true)
    setError(null)
    try {
      const job = await recheckJob(jobId, "continue")
      onQueued(job.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not recheck this job.")
    } finally {
      setPending(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => void recheck()}>
        {pending ? "Queuing recheck…" : "Recheck for more pages"}
      </Button>
      {error ? <span className="text-xs text-rose-800">{error}</span> : null}
    </span>
  )
}
