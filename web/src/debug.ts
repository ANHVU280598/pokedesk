import { EMPLOYEES, type EmployeeId, type StationId } from "@pulse/shared";
import type { Anim, Cast } from "./characters";
import { STATION_LIST } from "./characters";

const ACTIONS: { id: Anim; label: string }[] = [
  { id: "idle", label: "Idle" },
  { id: "working", label: "Working" },
  { id: "done", label: "Done" },
  { id: "error", label: "Error" },
];

const ZONE_LABEL: Record<StationId, string> = {
  planning: "Planning",
  data: "Data",
  writing: "Writing",
  factcheck: "Fact-check",
  growth: "Growth",
  outbox: "Outbox",
};

export function mountDebug(cast: Cast): void {
  if (!new URLSearchParams(window.location.search).has("debug")) return;
  const panel = document.createElement("details");
  panel.id = "debug";
  const summary = document.createElement("summary");
  summary.textContent = "Debug";
  panel.appendChild(summary);

  const select = document.createElement("select");
  select.id = "debug-who";
  for (const employee of EMPLOYEES) {
    const option = document.createElement("option");
    option.value = employee.id;
    option.textContent = employee.name;
    select.appendChild(option);
  }
  panel.appendChild(select);

  const actions = document.createElement("div");
  actions.className = "debug-row";
  for (const action of ACTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.act = action.id;
    button.textContent = action.label;
    button.addEventListener("click", () => {
      cast.play(select.value as EmployeeId, action.id);
    });
    actions.appendChild(button);
  }
  panel.appendChild(actions);

  const zones = document.createElement("div");
  zones.className = "debug-row";
  for (const station of STATION_LIST) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.go = station;
    button.textContent = ZONE_LABEL[station];
    button.addEventListener("click", () => {
      void cast.moveTo(select.value as EmployeeId, station);
    });
    zones.appendChild(button);
  }
  panel.appendChild(zones);
  document.body.appendChild(panel);
}
