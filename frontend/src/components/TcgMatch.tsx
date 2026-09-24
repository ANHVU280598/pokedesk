import { Button } from "@/components/ui/button"
import { formatMoney } from "../format"

export type TcgFields = {
  tcg_status?: string | null
  tcg_url?: string | null
  tcg_name?: string | null
  tcg_set?: string | null
  tcg_price?: number | null
  tcg_price_label?: string | null
  tcg_currency?: string | null
}

export function TcgMatchCell({
  match,
  productId,
  onConfirm,
  onCompare,
}: {
  match: TcgFields
  productId?: number
  onConfirm?: (productId: number) => void
  onCompare?: (productId: number) => void
}) {
  if (!match.tcg_status) {
    return <span className="text-muted-foreground">—</span>
  }
  if (match.tcg_status === "unmatched") {
    return <span className="text-muted-foreground">Unmatched</span>
  }
  if (match.tcg_status === "needs_confirm") {
    return (
      <span className="block max-w-[220px]">
        <span className="block text-xs text-amber-800">Several listings</span>
        {productId != null && onConfirm ? (
          <Button
            type="button"
            size="sm"
            className="mt-1"
            onClick={(event) => {
              event.stopPropagation()
              onConfirm(productId)
            }}
          >
            Choose listing
          </Button>
        ) : (
          <span className="text-sm">Needs confirmation</span>
        )}
      </span>
    )
  }
  const label = match.tcg_name || "TCGPlayer"
  const price =
    match.tcg_price == null
      ? null
      : `${match.tcg_price_label ? `${match.tcg_price_label} ` : ""}${formatMoney(match.tcg_price, match.tcg_currency ?? "USD")}`
  return (
    <span className="block max-w-[220px]">
      {match.tcg_url ? (
        <a
          href={match.tcg_url}
          target="_blank"
          rel="noreferrer"
          className="line-clamp-2 text-primary underline"
          onClick={(event) => event.stopPropagation()}
        >
          {label}
        </a>
      ) : (
        <span className="line-clamp-2">{label}</span>
      )}
      {match.tcg_set ? (
        <span className="block truncate text-xs text-muted-foreground">{match.tcg_set}</span>
      ) : null}
      {price ? <span className="block text-xs text-muted-foreground">{price}</span> : null}
      {productId != null && (onCompare || onConfirm) ? (
        <span className="mt-1 flex flex-wrap gap-1">
          {onCompare ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={(event) => {
                event.stopPropagation()
                onCompare(productId)
              }}
            >
              Compare
            </Button>
          ) : null}
          {onConfirm ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation()
                onConfirm(productId)
              }}
            >
              Change
            </Button>
          ) : null}
        </span>
      ) : null}
    </span>
  )
}
