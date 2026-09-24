import type {
  Job,
  JobMode,
  ObservationPage,
  OperatorSettings,
  Product,
} from "./types"

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    let detail = response.statusText || "Request failed"
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === "string") {
        detail = body.detail
      } else if (Array.isArray(body.detail)) {
        detail = body.detail
          .map((item) =>
            item && typeof item === "object" && "msg" in item
              ? String(item.msg)
              : "",
          )
          .filter(Boolean)
          .join("; ")
      }
    } catch {
      /* keep the status text */
    }
    throw new ApiError(response.status, detail || "Request failed")
  }
  return response.json() as Promise<T>
}

export function listJobs() {
  return api<Job[]>("/api/jobs")
}

export function getJob(id: number) {
  return api<Job>(`/api/jobs/${id}`)
}

export function createJob(body: {
  mode: JobMode
  start_url?: string
  search_query?: string
  search_terms?: string | null
  min_price?: number | null
  max_price?: number | null
  department?: string
  max_pages?: number
  delay_sec?: number
  headless?: boolean
  fixture_set?: string
}) {
  return api<Job>("/api/jobs", { method: "POST", body: JSON.stringify(body) })
}

export function pauseJob(id: number) {
  return api<Job>(`/api/jobs/${id}/pause`, { method: "POST" })
}

export function resumeJob(id: number) {
  return api<Job>(`/api/jobs/${id}/resume`, { method: "POST" })
}

export function stopJob(id: number) {
  return api<Job>(`/api/jobs/${id}/stop`, { method: "POST" })
}

export function retryJob(id: number) {
  return api<Job>(`/api/jobs/${id}/retry`, { method: "POST" })
}

export function listObservations(
  id: number,
  params: {
    q?: string
    min_rating?: number
    min_price?: number
    max_price?: number
    sort?: string
    limit?: number
  },
) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value))
  }
  const suffix = query.size ? `?${query}` : ""
  return api<ObservationPage>(`/api/jobs/${id}/observations${suffix}`)
}

export function getProduct(id: number) {
  return api<Product>(`/api/products/${id}`)
}

export function getSettings() {
  return api<OperatorSettings>("/api/settings")
}

export function putSettings(body: OperatorSettings) {
  return api<OperatorSettings>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  })
}
