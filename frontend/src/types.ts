export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "blocked"

export type PaginationMode = "next_page" | "show_more" | "unknown"

export type JobMode = "url" | "search" | "fixture"

export type JobSettings = {
  max_pages: number
  delay_ms: number
  headless: boolean
  mode?: JobMode
  min_price?: number | null
  max_price?: number | null
  department?: string | null
  fixture_set?: "pokemon" | "captcha" | "pagecap" | "showmore" | null
  resume_url?: string | null
  next_page_number?: number
  block_acknowledged?: boolean
  stopped_by_operator?: boolean
  retry_wait_sec?: number | null
}

export type Job = {
  id: number
  start_url: string | null
  search_query: string | null
  search_terms: string | null
  status: JobStatus
  pagination_mode: PaginationMode
  pages_visited: number
  items_scraped: number
  started_at: string | null
  finished_at: string | null
  error_message: string | null
  settings: JobSettings
  created_at: string
  updated_at: string
}

export type Observation = {
  observation_id: number
  job_id: number
  product_id: number
  asin: string | null
  title: string
  image_url: string | null
  product_url: string | null
  category_breadcrumbs: string | null
  price: number | null
  currency: string | null
  list_price: number | null
  rating: number | null
  review_count: number | null
  badges: string[]
  seller: string | null
  availability_snippet: string | null
  page_number: number | null
  observed_at: string
}

export type ObservationPage = {
  job_id: number
  total: number
  items: Observation[]
}

export type ProductObservation = {
  observation_id: number
  job_id: number
  price: number | null
  currency: string | null
  list_price: number | null
  rating: number | null
  review_count: number | null
  badges: string[]
  seller: string | null
  availability_snippet: string | null
  observed_at: string
  page_number: number | null
}

export type Product = {
  id: number
  asin: string | null
  title: string
  image_url: string | null
  product_url: string | null
  category_breadcrumbs: string | null
  first_seen_at: string
  last_seen_at: string
  observations: ProductObservation[]
}

export type OperatorSettings = {
  delay_sec: number
  max_pages: number
  headless: boolean
}

export type View = "new" | "live" | "results" | "history" | "settings"
