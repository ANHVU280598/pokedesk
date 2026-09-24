import type { Job, JobMode } from "./types"

export function formatMoney(price: number | null, currency: string | null) {
  if (price == null) return "—"
  const code = currency || "USD"
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(price)
  } catch {
    return `${code} ${price.toFixed(2)}`
  }
}

export function formatWhen(iso: string | null) {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function formatRating(rating: number | null) {
  if (rating == null) return "—"
  return rating.toFixed(1)
}

export function formatCount(value: number | null) {
  if (value == null) return "—"
  return value.toLocaleString("en-US")
}

export function formatBought(count: number | null, text: string | null) {
  if (text) return text
  if (count == null) return "—"
  return count.toLocaleString("en-US")
}

export function jobMode(job: Job): JobMode {
  if (
    job.settings.mode === "url" ||
    job.settings.mode === "search" ||
    job.settings.mode === "fixture" ||
    job.settings.mode === "tcgplayer" ||
    job.settings.mode === "manual"
  ) {
    return job.settings.mode
  }
  if (job.start_url?.startsWith("fixture:")) return "fixture"
  if (job.search_query) return "search"
  return "url"
}

export function sourceLabel(job: Job) {
  if (jobMode(job) === "manual") return "Manual Amazon page"
  if (jobMode(job) === "tcgplayer") {
    const source = job.settings.source_job_id
    return source ? `TCGPlayer match · job ${source}` : "TCGPlayer match"
  }
  if (jobMode(job) === "fixture") {
    return job.search_query ? `${job.search_query} · fixture` : "Fixture dry-run"
  }
  if (job.search_query) return job.search_query
  if (job.start_url) return job.start_url.replace(/^https?:\/\/(www\.)?/, "")
  return "Untitled scrape"
}

export function paginationLabel(mode: Job["pagination_mode"]) {
  if (mode === "next_page") return "Next page"
  if (mode === "show_more") return "Show more"
  return "Not detected yet"
}

export function stoppedByOperator(job: Job) {
  return (
    job.status === "completed" &&
    (job.settings.stopped_by_operator || job.error_message === "Stopped by operator")
  )
}
