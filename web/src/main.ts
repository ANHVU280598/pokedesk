import type { EmployeeId } from "@pulse/shared";
import { createCast, type Cast } from "./characters";
import { mountDebug } from "./debug";
import { createOffice, type Office } from "./scene";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#view");
const boot = document.querySelector<HTMLElement>("#boot");
if (!canvas || !boot) {
  throw new Error("Missing canvas");
}

const office = createOffice(canvas);
const cast = createCast(office.actorRoot, office.scene, office.camera);
mountDebug(cast);

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
    return;
  }
  focused = null;
  office.resetView();
});

declare global {
  interface Window {
    __office?: Office;
    __cast?: Cast;
  }
}

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
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
