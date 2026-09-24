import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { listJobs } from "./api"
import { Sidebar } from "./components/Sidebar"
import type { Job, MatchHandoff, View } from "./types"
import { History } from "./views/History"
import { Database } from "./views/Database"
import { LiveJob } from "./views/LiveJob"
import { NewScrape } from "./views/NewScrape"
import { Results } from "./views/Results"
import { Settings } from "./views/Settings"

const ACTIVE = new Set(["queued", "running", "paused"])

export default function App() {
  const [view, setView] = useState<View>("new")
  const [activeJobId, setActiveJobId] = useState<number | null>(null)
  const [resultsJobId, setResultsJobId] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [booted, setBooted] = useState(false)
  const [apiDown, setApiDown] = useState(false)
  const matchHandoff = useRef<{ matchJobId: number; returnTo: MatchHandoff } | null>(null)

  const boot = useCallback(async () => {
    try {
      const jobs = await listJobs()
      const active = jobs.find((job) => ACTIVE.has(job.status))
      if (active) {
        setActiveJobId(active.id)
        setView("live")
        setRunning(true)
      } else {
        setRunning(false)
      }
      setApiDown(false)
    } catch {
      setApiDown(true)
    } finally {
      setBooted(true)
    }
  }, [])

  useEffect(() => {
    void boot()
  }, [boot])

  useEffect(() => {
    if (!booted || apiDown) return
    const timer = window.setInterval(() => {
      listJobs()
        .then((jobs) => setRunning(jobs.some((job) => ACTIVE.has(job.status))))
        .catch(() => setApiDown(true))
    }, 4000)
    return () => window.clearInterval(timer)
  }, [booted, apiDown])

  function started(jobId: number) {
    setActiveJobId(jobId)
    setRunning(true)
    setView("live")
  }

  function openResults(jobId: number) {
    setResultsJobId(jobId)
    setView("results")
  }

  function startMatch(matchJobId: number, returnTo: MatchHandoff) {
    matchHandoff.current = { matchJobId, returnTo }
    started(matchJobId)
  }

  const onLiveJob = useCallback((job: Job) => {
    setRunning(ACTIVE.has(job.status))
    const handoff = matchHandoff.current
    if (!handoff || job.id !== handoff.matchJobId || ACTIVE.has(job.status)) return
    matchHandoff.current = null
    if (handoff.returnTo.view === "results") {
      setResultsJobId(handoff.returnTo.jobId)
      setView("results")
    } else {
      setView("database")
    }
  }, [])

  return (
    <div className="min-h-svh md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <Sidebar view={view} running={running} onChange={setView} />
      <main className="min-w-0 px-4 py-6 md:px-8 md:py-8">
        {!booted ? (
          <p className="text-sm text-muted-foreground">Loading the ledger…</p>
        ) : apiDown ? (
          <div className="mx-auto max-w-lg rounded-xl border bg-card p-6">
            <h1 className="text-xl font-semibold">API isn’t running</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Start the backend, then try again. From the repo root, with the virtualenv active:
            </p>
            <pre className="mt-3 overflow-x-auto rounded-md bg-[#241c16] px-3 py-2 text-xs text-[#f6f1e8]">
              uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8765
            </pre>
            <Button className="mt-4" onClick={() => void boot()}>
              Try again
            </Button>
          </div>
        ) : view === "new" ? (
          <NewScrape onStarted={started} />
        ) : view === "live" ? (
          <LiveJob
            jobId={activeJobId}
            onOpenResults={openResults}
            onJob={onLiveJob}
            onAdopt={started}
            onStartMatch={startMatch}
          />
        ) : view === "results" ? (
          <Results initialJobId={resultsJobId} onStartMatch={startMatch} />
        ) : view === "history" ? (
          <History onView={openResults} onStarted={started} />
        ) : view === "database" ? (
          <Database onStartMatch={startMatch} />
        ) : (
          <Settings />
        )}
      </main>
    </div>
  )
}
