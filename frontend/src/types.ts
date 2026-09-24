export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "blocked"

export type PaginationMode = "next_page" | "show_more" | "unknown"

export type JobMode = "url" | "search" | "fixture" | "tcgplayer"

export type JobSettings = {
  max_pages: number
  delay_ms: number
  headless: boolean
  mode?: JobMode
  min_price?: number | null
  max_price?: number | null
  department?: string | null
  fixture_set?: "pokemon" | "captcha" | "pagecap" | "showmore" | "relatedcap" | null
  expand_related?: boolean
  related_cards_limit?: number
  recheck_after_block?: boolean
  pattern_phase?: "related" | "recheck" | null
  pattern_handled?: boolean
  related_index?: number
  related_total?: number
  related_visited?: number
  resume_url?: string | null
  next_page_number?: number
  block_acknowledged?: boolean
  stopped_by_operator?: boolean
  retry_wait_sec?: number | null
  sort?: string | null
  proxy_enabled?: boolean
  proxy_url?: string
  proxy_username?: string
  proxy_password?: string
  proxy_password_set?: boolean
  recheck_mode?: string | null
  recheck_outcome?: "advanced" | "unchanged" | null
  recheck_pending?: boolean
  recheck_pages_before?: number
  recheck_items_before?: number
  fixture?: boolean
  source_job_id?: number | null
  product_ids?: number[]
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
  parent_job_id: number | null
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
  bought_past_month: number | null
  bought_past_month_text: string | null
  badges: string[]
  seller: string | null
  availability_snippet: string | null
  page_number: number | null
  observed_at: string
  source?: "results" | "related"
  tcg_status?: string | null
  tcg_url?: string | null
  tcg_name?: string | null
  tcg_set?: string | null
  tcg_price?: number | null
  tcg_currency?: string | null
  tcg_confidence?: number | null
  tcg_query?: string | null
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
  bought_past_month: number | null
  bought_past_month_text: string | null
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
  tcg_status?: string | null
  tcg_url?: string | null
  tcg_name?: string | null
  tcg_set?: string | null
  tcg_price?: number | null
  tcg_currency?: string | null
  tcg_confidence?: number | null
  tcg_query?: string | null
}

export type OperatorSettings = {
  delay_sec: number
  max_pages: number
  headless: boolean
  proxy_enabled: boolean
  proxy_url: string
  proxy_username: string
  proxy_password: string
  proxy_password_set: boolean
  expand_related: boolean
  related_cards_limit: number
  recheck_after_block: boolean
}

export type SettingsWrite = {
  delay_sec: number
  max_pages: number
  headless: boolean
  proxy_enabled: boolean
  proxy_url: string
  proxy_username: string
  proxy_password: string
  clear_proxy_password?: boolean
  expand_related: boolean
  related_cards_limit: number
  recheck_after_block: boolean
}

export type ProxyMode = "default" | "off" | "custom"

export type FollowUpSuggestion = {
  id: string
  kind: "price" | "sort" | "query"
  label: string
  detail: string
  start_url: string
  min_price: number | null
  max_price: number | null
  sort: string
}

export type CatalogProduct = {
  id: number
  asin: string | null
  title: string
  image_url: string | null
  product_url: string | null
  category_breadcrumbs: string | null
  first_seen_at: string
  last_seen_at: string
  observation_count: number
  bought_past_month: number | null
  bought_past_month_text: string | null
  tcg_status?: string | null
  tcg_url?: string | null
  tcg_name?: string | null
  tcg_set?: string | null
  tcg_price?: number | null
  tcg_currency?: string | null
}

export type DuplicateHint = {
  id: string
  reason: string
  keep_id: number
  drop_id: number
  keep_title: string
  drop_title: string
  keep_asin: string | null
  drop_asin: string | null
}

export type View = "new" | "live" | "results" | "history" | "settings" | "database"
