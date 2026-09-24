import type { View } from "../types"

const ITEMS: { id: View; label: string }[] = [
  { id: "new", label: "New scrape" },
  { id: "live", label: "Live job" },
  { id: "results", label: "Results" },
  { id: "history", label: "History" },
  { id: "database", label: "Database" },
  { id: "settings", label: "Settings" },
]

export function Sidebar({
  view,
  running,
  onChange,
}: {
  view: View
  running: boolean
  onChange: (view: View) => void
}) {
  return (
    <aside className="flex flex-col bg-[#241c16] text-[#f6f1e8] md:sticky md:top-0 md:h-svh">
      <div className="flex items-center gap-3 px-4 py-4 md:px-5 md:pt-6">
        <span className="grid size-9 place-items-center rounded-md bg-[#c2410c] text-sm font-semibold text-white">
          Cd
        </span>
        <div>
          <div className="text-sm font-semibold tracking-tight">Catalog Desk</div>
          <div className="text-xs text-[#cfc3b4]">Local scrape ledger</div>
        </div>
      </div>
      <nav
        className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:px-3"
        aria-label="Screens"
      >
        {ITEMS.map((item) => {
          const active = view === item.id
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onChange(item.id)}
              className={`flex items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm whitespace-nowrap ${
                active
                  ? "bg-[#3a2e26] text-white"
                  : "text-[#eadfd2] hover:bg-[#31261f]"
              }`}
            >
              <span>{item.label}</span>
              {item.id === "live" && running ? (
                <span className="size-2 rounded-full bg-sky-400" aria-label="Job active" />
              ) : null}
            </button>
          )
        })}
      </nav>
      <p className="hidden px-5 py-5 text-xs leading-relaxed text-[#cfc3b4] md:block">
        SQLite on this machine. Cards stay local. Amazon soft-blocks stop the job and keep what was already stored.
      </p>
    </aside>
  )
}
