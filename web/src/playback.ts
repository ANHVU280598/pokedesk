import { employeeById, type EmployeeId, type WorkEvent } from "@pulse/shared";
import { Vector3 } from "three";
import { getEvents, getLatestIssue, getRun, startRun } from "./api";
import type { Cast } from "./characters";
import type { Handoff } from "./handoff";
import type { Office } from "./scene";
import type { Ui } from "./ui";

type Bubble = {
  id: EmployeeId;
  el: HTMLButtonElement;
  until: number;
  expanded: boolean;
  summary: string;
  full: string;
};

const bubbles: Bubble[] = [];

export function placeBubbles(project: (id: EmployeeId) => { x: number; y: number; visible: boolean }): void {
  const now = performance.now();
  for (let index = bubbles.length - 1; index >= 0; index -= 1) {
    const bubble = bubbles[index];
    if (!bubble.expanded && now > bubble.until) {
      bubble.el.remove();
      bubbles.splice(index, 1);
      continue;
    }
    const point = project(bubble.id);
    bubble.el.style.left = `${point.x}px`;
    bubble.el.style.top = `${point.y - 56}px`;
    bubble.el.style.display = point.visible ? "block" : "none";
  }
}

export async function playRun(input: {
  ui: Ui;
  cast: Cast;
  office: Office;
  handoff: Handoff;
  focus: (id: EmployeeId | null) => void;
}): Promise<void> {
  const { ui, cast, handoff, focus } = input;
  ui.setBusy(true);
  ui.setStatus("Running 0/7");
  ui.toast("The desk is starting.");
  let runId = "";
  try {
    runId = await startRun();
  } catch (error) {
    ui.setBusy(false);
    ui.setStatus("Failed");
    ui.toast(error instanceof Error ? error.message : "The run did not start.");
    return;
  }

  const seen: WorkEvent[] = [];
  const queue: WorkEvent[] = [];
  let after = "";
  let failures = 0;
  let stopped = false;
  const deadline = Date.now() + 180_000;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const poll = async () => {
    while (!stopped) {
      if (Date.now() > deadline) {
        stopped = true;
        ui.toast("The run timed out. Nothing was sent.");
        return;
      }
      try {
        const events = await getEvents(runId, after || undefined);
        failures = 0;
        for (const event of events) {
          queue.push(event);
          seen.push(event);
          after = event.id;
        }
        if (events.length) ui.setEvents(seen);
        const run = await getRun(runId);
        if ((run.status === "succeeded" || run.status === "failed") && queue.length === 0) {
          stopped = true;
          if (run.status === "failed") ui.toast(run.error || "The run stopped.");
          return;
        }
      } catch {
        failures += 1;
        if (failures === 1) ui.toast("Reconnecting…");
        await sleep(Math.min(10000, 1500 * 2 ** (failures - 1)));
        continue;
      }
      await sleep(1500);
    }
  };

  const playing = (async () => {
    let previous: EmployeeId | null = null;
    let played = 0;
    while (!stopped || queue.length > 0) {
      const event = queue.shift();
      if (!event) {
        await sleep(120);
        continue;
      }
      played += 1;
      ui.setStatus(event.status === "error" ? "Failed" : `Running ${Math.min(played, 7)}/7`);
      const speed = ui.speed();
      cast.setTimeScale(speed === 0 ? 0 : speed);
      if (ui.autoFollow()) focus(event.employee);
      if (previous && previous !== event.employee) {
        const from = anchor(input.cast, previous);
        const to = anchor(input.cast, event.employee);
        const ms = reduced || speed === 0 ? 0 : speed === 2 ? 500 : 1000;
        await handoff.fly(from, to, employeeById(previous).color, employeeById(event.employee).color, ms);
      }
      await input.cast.moveTo(event.employee, event.station);
      if (event.status === "error") {
        input.cast.play(event.employee, "error");
        showBubble(event, speed, reduced);
        ui.toast(event.summary);
        stopped = true;
        break;
      }
      input.cast.play(event.employee, "working");
      showBubble(event, speed, reduced);
      await sleep(hold(speed, reduced));
      input.cast.play(event.employee, "done");
      previous = event.employee;
    }
  })();

  await Promise.all([poll(), playing]);
  ui.setBusy(false);
  try {
    const issue = await getLatestIssue();
    if (issue && issue.runId === runId) {
      ui.setIssue(issue);
      ui.setStatus(issue.status === "pending_approval" ? "Waiting for approval" : "Idle");
      ui.open("issue");
      ui.toast("Draft is ready. Nothing was sent.");
      return;
    }
  } catch {
    ui.toast("The draft finished, but the issue could not be loaded.");
  }
  if (ui.events().some((event) => event.status === "error")) ui.setStatus("Failed");
}

function showBubble(event: WorkEvent, speed: 0 | 1 | 2, reduced: boolean): void {
  const host = document.querySelector("#bubbles");
  if (!host) return;
  const employee = employeeById(event.employee);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "speech";
  button.textContent = event.summary;
  button.style.borderLeftColor = employee.color;
  const life = reduced || speed === 0 ? 400 : speed === 2 ? 1500 : 3000;
  const bubble: Bubble = {
    id: event.employee,
    el: button,
    until: performance.now() + life,
    expanded: false,
    summary: event.summary,
    full: event.fullText,
  };
  button.addEventListener("click", () => {
    bubble.expanded = !bubble.expanded;
    button.textContent = bubble.expanded ? bubble.full : bubble.summary;
    if (!bubble.expanded) bubble.until = performance.now() + life;
  });
  host.appendChild(button);
  bubbles.push(bubble);
}

function anchor(cast: Cast, id: EmployeeId): Vector3 {
  const point = cast.focusPoint(id).clone();
  point.y = 1.2;
  return point;
}

function hold(speed: 0 | 1 | 2, reduced: boolean): number {
  if (reduced || speed === 0) return 180;
  return speed === 2 ? 700 : 1400;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
