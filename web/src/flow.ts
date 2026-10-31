import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Vector3,
} from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { EmployeeId } from "@pulse/shared";

export type FlowStep = {
  n: number;
  employee: EmployeeId;
  action: string;
  title: string;
  detail?: string;
  phoneTitle?: string;
  phoneDetail?: string;
  whenActive?: boolean;
};

export const FLOW_STEPS: FlowStep[] = [
  {
    n: 1,
    employee: "maya",
    action: "assign",
    title: "Assign today's issue",
    phoneTitle: "Assign\ntoday's issue",
  },
  {
    n: 2,
    employee: "rex",
    action: "research",
    title: "Search CoinGecko",
    detail: "trending and top movers",
    phoneTitle: "Search\nCoinGecko",
    phoneDetail: "trending and\ntop movers",
  },
  {
    n: 3,
    employee: "luna",
    action: "draft",
    title: "Write the summary",
    phoneTitle: "Write the\nsummary",
  },
  {
    n: 4,
    employee: "victor",
    action: "factcheck",
    title: "Fact-check, no predictions",
    phoneTitle: "Fact-check,\nno predictions",
  },
  {
    n: 5,
    employee: "luna",
    action: "revise",
    title: "Revise the summary",
    phoneTitle: "Revise the\nsummary",
    whenActive: true,
  },
  {
    n: 6,
    employee: "ivy",
    action: "monetize",
    title: "Subject line",
    detail: "disclosed affiliates",
    phoneTitle: "Subject line",
    phoneDetail: "disclosed\naffiliates",
  },
  {
    n: 7,
    employee: "maya",
    action: "finish",
    title: "Ready for approval",
    detail: "lands in the outbox",
    phoneTitle: "Ready for\napproval",
    phoneDetail: "lands in\nthe outbox",
  },
];

const CHIP_COLOR: Record<number, string> = {
  1: "#3A5BD9",
  2: "#C2570C",
  3: "#B0338A",
  4: "#2F7D6D",
  5: "#B0338A",
  6: "#7A4FD1",
  7: "#3A5BD9",
};

const STOPS: Array<{ n: number; x: number; z: number; caption?: string }> = [
  { n: 1, x: 0, z: -6.55 },
  { n: 2, x: -6.15, z: -2.35 },
  { n: 3, x: -4.7, z: 4.5 },
  { n: 4, x: 4.7, z: 4.5 },
  { n: 5, x: -5.85, z: 5.25 },
  { n: 6, x: 6.2, z: -2.35 },
  { n: 7, x: 0, z: 0.15, caption: "Outbox" },
];

const ROUTE = [1, 2, 3, 4, 6, 7];

export type OperationFlow = {
  setTheme(mode: "light" | "dark"): void;
  pulse(time: number): void;
};

export function mountOperationFlow(scene: Scene): OperationFlow {
  const group = new Group();
  group.name = "operation-flow";
  const ribbon = new MeshStandardMaterial({
    color: "#E4D3A2",
    emissive: "#C6A15A",
    emissiveIntensity: 0.35,
    roughness: 0.72,
    metalness: 0,
    flatShading: true,
  });
  let mode: "light" | "dark" = "light";

  for (let index = 0; index < ROUTE.length - 1; index += 1) {
    group.add(segment(stop(ROUTE[index]), stop(ROUTE[index + 1]), ribbon));
  }
  group.add(segment(stop(3), stop(5), ribbon));

  for (const stop of STOPS) {
    const wrap = document.createElement("div");
    wrap.className = "flow-stop";
    wrap.dataset.flow = String(stop.n);
    const chip = document.createElement("span");
    chip.className = "flow-chip";
    chip.textContent = String(stop.n);
    chip.style.background = CHIP_COLOR[stop.n];
    wrap.appendChild(chip);
    if (stop.caption) {
      const caption = document.createElement("span");
      caption.className = "flow-caption";
      caption.textContent = stop.caption;
      wrap.appendChild(caption);
    }
    const label = new CSS2DObject(wrap);
    label.position.set(stop.x, 0.42, stop.z);
    label.renderOrder = 1;
    group.add(label);
  }

  scene.add(group);

  return {
    setTheme(next) {
      mode = next;
      if (next === "dark") {
        ribbon.color.set("#6E5A32");
        ribbon.emissive.set("#E4C56A");
        ribbon.emissiveIntensity = 0.55;
      } else {
        ribbon.color.set("#E4D3A2");
        ribbon.emissive.set("#C6A15A");
        ribbon.emissiveIntensity = 0.35;
      }
    },
    pulse(time) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const base = mode === "dark" ? 0.55 : 0.35;
      ribbon.emissiveIntensity = reduced ? base : base + Math.sin(time * 2) * 0.07;
    },
  };
}

export function highlightFlow(action: string | null): void {
  const match = FLOW_STEPS.find((step) => step.action === action);
  const active = match?.n ?? null;
  document.querySelectorAll<HTMLElement>("[data-flow]").forEach((node) => {
    const step = Number(node.dataset.flow);
    node.classList.toggle("is-active", active === step);
    if (node.dataset.when === "active") node.hidden = active !== step;
  });
}

function stop(n: number): { x: number; z: number } {
  const found = STOPS.find((item) => item.n === n);
  if (!found) throw new Error(`Missing flow stop ${n}`);
  return found;
}

function segment(
  from: { x: number; z: number },
  to: { x: number; z: number },
  material: MeshStandardMaterial,
): Mesh {
  const start = new Vector3(from.x, 0.08, from.z);
  const end = new Vector3(to.x, 0.08, to.z);
  const length = start.distanceTo(end);
  const mesh = new Mesh(new BoxGeometry(length, 0.045, 0.14), material);
  mesh.position.copy(start).lerp(end, 0.5);
  mesh.rotation.y = Math.atan2(-(end.z - start.z), end.x - start.x);
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  return mesh;
}
