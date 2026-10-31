import { createOffice } from "./scene";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#view");
const boot = document.querySelector<HTMLElement>("#boot");
if (!canvas || !boot) {
  throw new Error("Missing canvas");
}

const office = createOffice(canvas);
const context = office.renderer.getContext();
if (!context) {
  boot.textContent = "This browser could not start WebGL.";
} else {
  canvas.dataset.ready = "1";
  boot.dataset.state = "ready";
}

declare global {
  interface Window {
    __office?: typeof office;
  }
}

window.__office = office;

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!document.hidden) {
    office.update(dt);
    office.render();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
