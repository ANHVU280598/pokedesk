import type { EmployeeId } from "@pulse/shared";
import { approveIssue, getEvents, getLatestIssue, prepareIssuePublish, saveIssue } from "./api";
import { createCast, type Cast } from "./characters";
import { mountDebug } from "./debug";
import { createHandoff } from "./handoff";
import { placeBubbles, playRun, watchEvents } from "./playback";
import { createOffice, type Office } from "./scene";
import { mountBrief } from "./brief";
import { mountUi, type Ui } from "./ui";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#view");
const boot = document.querySelector<HTMLElement>("#boot");
if (!canvas || !boot) {
  throw new Error("Missing canvas");
}

const office = createOffice(canvas);
const cast = createCast(office.actorRoot, office.scene, office.camera);
const handoff = createHandoff(office.scene);
const demo = window.location.pathname === "/demo" || window.location.hash === "#demo";
const ui = mountUi();
mountBrief();
ui.setIssue(ui.issue());
if (demo) ui.setDemo(true);
mountDebug(cast);
ui.onSpeed((speed) => cast.setTimeScale(speed === 0 ? 0 : speed));
const focusOn = (id: EmployeeId | null) => {
  focused = id;
  if (id) office.follow(cast.focusPoint(id), 16);
};
ui.onRun(() => {
  if (demo) {
    void watchEvents(ui.events(), { ui, cast, handoff, focus: focusOn });
    return;
  }
  void playRun({ ui, cast, office, handoff, focus: focusOn });
});
ui.onSave(async (issue) => {
  const saved = await saveIssue(issue.id, issue.subject, issue.body);
  ui.setIssue(saved);
  ui.toast("Saved. Nothing was sent.");
});
ui.onApprove(async (issue) => {
  const saved = await approveIssue(issue.id);
  ui.setIssue(saved);
  const plan = await prepareIssuePublish(saved.id);
  ui.setStatus("Idle");
  ui.toast(plan.channels.some((channel) => channel.sent) ? "A channel reported a send." : "Approved. Nothing was sent.");
});

const context = office.renderer.getContext();
if (!context) {
  boot.textContent = "This browser could not start WebGL.";
} else {
  canvas.dataset.ready = "1";
  boot.dataset.state = "ready";
}

let focused: EmployeeId | null = null;
office.setTapHandler((x, y) => {
  const hits = office.raycast(x, y, cast.pickables());
  const id = hits.length > 0 ? cast.idFromObject(hits[0].object) : null;
  if (id) {
    focused = id;
    office.follow(cast.focusPoint(id), 14);
    ui.showProfile(id);
    return;
  }
  ui.close();
  focused = null;
  office.resetView();
});

declare global {
  interface Window {
    __office?: Office;
    __cast?: Cast;
    __ui?: Ui;
  }
}

window.__ui = ui;

window.__office = office;
window.__cast = cast;

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!document.hidden) {
    if (focused) office.track(cast.focusPoint(focused));
    office.update(dt);
    cast.update(dt);
    office.render();
    placeBubbles((id) => office.project(cast.focusPoint(id)));
  }
  requestAnimationFrame(frame);
}

void (async () => {
  try {
    const issue = await getLatestIssue(demo);
    if (!issue) {
      ui.setIssue(null);
      return;
    }
    ui.setIssue(issue);
    ui.setEvents(await getEvents(issue.runId));
    ui.setStatus(issue.status === "pending_approval" ? "Waiting for approval" : "Idle");
  } catch {
    ui.setIssue(null);
    ui.toast("The desk is offline. You can still look around.");
  }
})();
requestAnimationFrame(frame);
