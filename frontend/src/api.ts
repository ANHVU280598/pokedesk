import type {
  CatalogProduct,
  DuplicateHint,
  FollowUpSuggestion,
  Job,
  JobMode,
  ObservationPage,
  OperatorSettings,
  Product,
  ProxyMode,
  SettingsWrite,
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
  proxy_mode?: ProxyMode
  proxy_url?: string
  proxy_username?: string
  proxy_password?: string
  expand_related?: boolean
  related_cards_limit?: number
  recheck_after_block?: boolean
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
    min_bought?: number
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

export function putSettings(body: SettingsWrite) {
  return api<OperatorSettings>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  })
}

export function listFollowUps(jobId: number) {
  return api<{ job_id: number; suggestions: FollowUpSuggestion[] }>(
    `/api/jobs/${jobId}/follow-ups`,
  )
}

export function createFollowUps(jobId: number, suggestionIds: string[]) {
  return api<{ jobs: Job[]; parent: Job | null }>(`/api/jobs/${jobId}/follow-ups`, {
    method: "POST",
    body: JSON.stringify({ suggestion_ids: suggestionIds }),
  })
}

export function recheckJob(id: number, mode: "continue" | "reload" = "continue") {
  return api<Job>(`/api/jobs/${id}/recheck`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  })
}

export function deleteJob(id: number) {
  return api<{ ok: boolean }>(`/api/jobs/${id}`, { method: "DELETE" })
}

export function listProducts(params: {
  q?: string
  has_asin?: string
  last_seen_after?: string
  last_seen_before?: string
  limit?: number
  offset?: number
}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value))
  }
  const suffix = query.size ? `?${query}` : ""
  return api<{ total: number; items: CatalogProduct[] }>(`/api/products${suffix}`)
}

export function listDuplicates() {
  return api<{ hints: DuplicateHint[] }>("/api/products/duplicates")
}

export function mergeProducts(keepId: number, dropId: number) {
  return api<Product>("/api/products/merge", {
    method: "POST",
    body: JSON.stringify({ keep_id: keepId, drop_id: dropId }),
  })
}

export function updateProduct(
  id: number,
  body: {
    title: string
    asin: string | null
    image_url: string | null
    product_url: string | null
    category_breadcrumbs: string | null
  },
) {
  return api<Product>(`/api/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

export function deleteProduct(id: number, force = false) {
  const suffix = force ? "?force=true" : ""
  return api<{ ok: boolean }>(`/api/products/${id}${suffix}`, { method: "DELETE" })
}

export function matchJobOnTcg(jobId: number, productIds?: number[]) {
  return api<Job>(`/api/jobs/${jobId}/tcg-match`, {
    method: "POST",
    body: JSON.stringify(productIds ? { product_ids: productIds } : {}),
  })
}

export function clearJobTcgMatches(jobId: number) {
  return api<{ ok: boolean; cleared: number }>(`/api/jobs/${jobId}/tcg-match`, {
    method: "DELETE",
  })
}

export function matchProductsOnTcg(productIds: number[]) {
  return api<Job>("/api/products/tcg-match", {
    method: "POST",
    body: JSON.stringify({ product_ids: productIds }),
  })
}

export function clearProductTcgMatch(productId: number) {
  return api<Product>(`/api/products/${productId}/tcg-match`, { method: "DELETE" })
}

export function deleteObservation(id: number) {
  return api<{ ok: boolean; job_id: number }>(`/api/observations/${id}`, {
    method: "DELETE",
  })
}
