import { formatMoney } from "../format"

export type TcgFields = {
  tcg_status?: string | null
  tcg_url?: string | null
  tcg_name?: string | null
  tcg_set?: string | null
  tcg_price?: number | null
  tcg_currency?: string | null
}

export function TcgMatchCell({ match }: { match: TcgFields }) {
  if (!match.tcg_status) {
    return <span className="text-muted-foreground">—</span>
  }
  if (match.tcg_status === "unmatched") {
    return <span className="text-muted-foreground">Unmatched</span>
  }
  const label = match.tcg_name || "TCGPlayer"
  return (
    <span className="block max-w-[220px]">
      {match.tcg_status === "needs_review" ? (
        <span className="block text-xs text-amber-800">Needs review</span>
      ) : null}
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
      {match.tcg_price != null ? (
        <span className="block text-xs text-muted-foreground">
          {formatMoney(match.tcg_price, match.tcg_currency ?? "USD")}
        </span>
      ) : null}
    </span>
  )
}
