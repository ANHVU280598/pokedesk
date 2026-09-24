import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ApiError, downloadExport, type ExportParams } from "../api"

export function ExportGroup({
  label,
  hint,
  dataset,
  params,
  disabled = false,
}: {
  label: string
  hint?: string
  dataset: "amazon-products" | "tcgplayer-matches" | "price-compare"
  params?: ExportParams
  disabled?: boolean
}) {
  const [busy, setBusy] = useState<"csv" | "xlsx" | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(format: "csv" | "xlsx") {
    setBusy(format)
    setError(null)
    try {
      await downloadExport(dataset, { ...params, format })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Export failed.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 sm:min-w-56">
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || busy !== null}
        aria-label={`${label} CSV`}
        onClick={() => void run("csv")}
      >
        {busy === "csv" ? "Exporting…" : "CSV"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || busy !== null}
        aria-label={`${label} Excel`}
        onClick={() => void run("xlsx")}
      >
        {busy === "xlsx" ? "Exporting…" : "Excel"}
      </Button>
      {error ? <p className="text-sm text-rose-800">{error}</p> : null}
    </div>
  )
}
