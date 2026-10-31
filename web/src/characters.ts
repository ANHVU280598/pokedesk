import {
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Scene,
  type Camera,
} from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { EMPLOYEES, STATIONS, type EmployeeId, type StationId } from "@pulse/shared";
import { FLOW_STEPS, highlightFlow } from "./flow";

export type Anim = "idle" | "walk" | "working" | "done" | "error";

const STAND: Record<StationId, { x: number; z: number; yaw: number }> = {
  planning: { x: 0, z: -8.2, yaw: Math.PI },
  data: { x: -8.2, z: -1.8, yaw: -Math.PI / 2 },
  writing: { x: -6, z: 6.4, yaw: 0 },
  factcheck: { x: 6, z: 6.4, yaw: 0 },
  growth: { x: 8.4, z: -1.8, yaw: Math.PI / 2 },
  outbox: { x: 0, z: 1.75, yaw: Math.PI },
};

type Actor = {
  id: EmployeeId;
  group: Group;
  bob: Group;
  tilt: Group;
  head: Group;
  leftArm: Group;
  rightArm: Group;
  leftLeg: Group;
  rightLeg: Group;
  icon: Object3D;
  ok: CSS2DObject;
  bad: CSS2DObject;
  anim: Anim;
  age: number;
  hunch: number;
  path: Vector3[];
  face: number;
  onArrive?: () => void;
  pending?: Anim;
  deadline: number;
  dust: Mesh[];
};

export type Cast = {
  update(dt: number): void;
  renderLabels(scene: Scene, camera: Camera): void;
  play(id: EmployeeId, anim: Anim): void;
  moveTo(id: EmployeeId, station: StationId): Promise<void>;
  state(id: EmployeeId): { anim: Anim; x: number; z: number };
  focusPoint(id: EmployeeId): Vector3;
  pickables(): Object3D[];
  idFromObject(object: Object3D): EmployeeId | null;
  setTimeScale(scale: number): void;
  setReducedMotion(on: boolean): void;
  setFlow(action: string | null): void;
};

const _focus = new Vector3();

export function createCast(parent: Group, scene: Scene, camera: Camera): Cast {
  const skin = material("#F0CDB4");
  const hair = material("#3B2A28");
  const ink = material("#1D1D1B");
  const actors = new Map<EmployeeId, Actor>();
  const labels = new CSS2DRenderer();
  labels.setSize(window.innerWidth, window.innerHeight);
  labels.domElement.className = "labels";
  labels.domElement.style.pointerEvents = "none";
  document.body.appendChild(labels.domElement);
  window.addEventListener("resize", () => labels.setSize(window.innerWidth, window.innerHeight));

  let timeScale = 1;
  let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (event) => {
    reduced = event.matches;
  });

  for (const employee of EMPLOYEES) {
    const home = STAND[employee.station];
    const actor = buildActor(employee.id, employee.color, skin, hair, ink);
    actor.group.position.set(home.x, 0, home.z);
    actor.group.rotation.y = home.yaw;
    actor.face = home.yaw;
    parent.add(actor.group);
    actors.set(employee.id, actor);
  }

  function update(dt: number): void {
    const step = reduced || timeScale <= 0 ? dt : dt * timeScale;
    for (const actor of actors.values()) {
      advance(actor, step, reduced || timeScale <= 0);
      const scale = timeScale <= 0 ? 1 : timeScale;
      pose(actor, dt * scale, reduced || timeScale <= 0);
    }
    labels.render(scene, camera);
  }

  return {
    update,
    renderLabels() {
      labels.render(scene, camera);
    },
    play(id, anim) {
      const actor = actors.get(id);
      if (!actor) return;
      if (actor.path.length > 0 && anim !== "idle") {
        actor.pending = anim;
        return;
      }
      if (anim === "idle") {
        actor.path = [];
        actor.onArrive?.();
        actor.onArrive = undefined;
      }
      actor.anim = anim;
      actor.age = 0;
    },
    moveTo(id, station) {
      const actor = actors.get(id);
      if (!actor) return Promise.resolve();
      actor.onArrive?.();
      const stand = STAND[station];
      const dest = new Vector3(stand.x, 0, stand.z);
      actor.face = stand.yaw;
      if (reduced || timeScale <= 0 || actor.group.position.distanceTo(dest) < 0.2) {
        actor.group.position.copy(dest);
        actor.group.rotation.y = stand.yaw;
        actor.path = [];
        actor.anim = "idle";
        actor.age = 0;
        return Promise.resolve();
      }
      const blockers = [...actors.values()]
        .filter((other) => other.id !== id)
        .map((other) => other.group.position.clone());
      actor.path = route(actor.group.position, dest, blockers);
      actor.anim = "walk";
      actor.age = 0;
      actor.deadline = performance.now() + 9000;
      return new Promise((resolve) => {
        actor.onArrive = resolve;
      });
    },
    state(id) {
      const actor = actors.get(id)!;
      return { anim: actor.anim, x: actor.group.position.x, z: actor.group.position.z };
    },
    focusPoint(id) {
      const actor = actors.get(id)!;
      actor.group.getWorldPosition(_focus);
      _focus.y = 1.2;
      return _focus;
    },
    pickables() {
      return [...actors.values()].map((actor) => actor.group);
    },
    idFromObject(object) {
      let current: Object3D | null = object;
      while (current) {
        const id = current.userData.employee as EmployeeId | undefined;
        if (id) return id;
        current = current.parent;
      }
      return null;
    },
    setTimeScale(scale) {
      timeScale = scale;
    },
    setReducedMotion(on) {
      reduced = on;
    },
    setFlow(action) {
      highlightFlow(action);
    },
  };
}

function advance(actor: Actor, dt: number, instant: boolean): void {
  if (actor.path.length === 0) return;
  if (instant || performance.now() > actor.deadline) {
    const last = actor.path[actor.path.length - 1];
    actor.group.position.copy(last);
    actor.group.rotation.y = actor.face;
    actor.path = [];
    actor.anim = actor.pending ?? "idle";
    actor.pending = undefined;
    actor.age = 0;
    actor.onArrive?.();
    actor.onArrive = undefined;
    return;
  }
  const speed = 5.4;
  let left = speed * dt;
  while (left > 0 && actor.path.length > 0) {
    const next = actor.path[0];
    const delta = next.clone().sub(actor.group.position);
    delta.y = 0;
    const dist = delta.length();
    if (dist < 0.001) {
      actor.path.shift();
      continue;
    }
    const yaw = Math.atan2(delta.x, delta.z);
    actor.group.rotation.y = dampAngle(actor.group.rotation.y, yaw, dt);
    if (dist <= left) {
      actor.group.position.copy(next);
      actor.group.position.y = 0;
      actor.path.shift();
      left -= dist;
    } else {
      delta.multiplyScalar(left / dist);
      actor.group.position.add(delta);
      left = 0;
    }
  }
  if (actor.path.length === 0) {
    actor.group.rotation.y = dampAngle(actor.group.rotation.y, actor.face, 1);
    actor.anim = actor.pending ?? "idle";
    actor.pending = undefined;
    actor.age = 0;
    actor.onArrive?.();
    actor.onArrive = undefined;
  }
}

function pose(actor: Actor, dt: number, reduced: boolean): void {
  actor.age += dt;
  const t = actor.age;
  const walking = actor.anim === "walk" && !reduced;
  actor.bob.position.y = !walking && actor.anim === "idle" && !reduced ? Math.sin(t * 2) * 0.045 : 0;
  actor.tilt.rotation.x = actor.hunch + (walking ? 0.28 : 0);
  actor.tilt.rotation.z = 0;
  actor.head.rotation.z = 0;
  const swing = walking ? Math.sin(t * 9) : 0;
  actor.leftLeg.rotation.x = swing * 0.75;
  actor.rightLeg.rotation.x = -swing * 0.75;
  actor.leftArm.rotation.x = walking ? -swing * 0.45 : 0;
  actor.rightArm.rotation.x = walking ? swing * 0.45 : 0;
  actor.icon.visible = false;
  actor.ok.element.style.display = "none";
  actor.bad.element.style.display = "none";
  for (const puff of actor.dust) puff.visible = false;

  if (actor.anim === "working") {
    actor.leftArm.rotation.x = -0.55 + Math.sin(t * 12) * 0.4;
    actor.rightArm.rotation.x = -0.55 + Math.sin(t * 12 + 1.2) * 0.4;
    actor.icon.visible = true;
    actor.icon.position.y = 2.05 + Math.sin(t * 3) * 0.04;
  }
  if (actor.anim === "done") {
    actor.bob.position.y = reduced ? 0 : Math.abs(Math.sin(t * 12)) * 0.16;
    actor.ok.element.style.display = "grid";
    if (t > 1.15) actor.anim = "idle";
  }
  if (actor.anim === "error") {
    actor.head.rotation.z = reduced ? 0 : Math.sin(t * 24) * 0.28;
    actor.bad.element.style.display = "grid";
    if (t > 1.15) actor.anim = "idle";
  }
  if (walking) {
    actor.dust.forEach((puff, index) => {
      puff.visible = true;
      const fade = (Math.sin(t * 10 + index) + 1) / 2;
      (puff.material as MeshStandardMaterial).opacity = 0.15 + fade * 0.35;
      puff.position.set((index - 1) * 0.12, 0.06, -0.2);
    });
  }
}

function route(from: Vector3, to: Vector3, blockers: Vector3[]): Vector3[] {
  const path = [to.clone()];
  for (const block of blockers) {
    if (block.distanceTo(to) < 0.4) continue;
    if (distanceToSegment(block, from, to) > 1.15) continue;
    const dir = to.clone().sub(from);
    dir.y = 0;
    const len = dir.length() || 1;
    const perp = new Vector3(-dir.z / len, 0, dir.x / len);
    const mid = from.clone().lerp(to, 0.5);
    const side = Math.sign(mid.clone().sub(block).dot(perp)) || 1;
    path.unshift(mid.add(perp.multiplyScalar(side * 1.7)));
    break;
  }
  return path;
}

function distanceToSegment(point: Vector3, a: Vector3, b: Vector3): number {
  const ab = b.clone().sub(a);
  ab.y = 0;
  const len2 = ab.lengthSq() || 1;
  const t = MathUtils.clamp(point.clone().sub(a).dot(ab) / len2, 0, 1);
  return a.clone().add(ab.multiplyScalar(t)).distanceTo(point);
}

function buildActor(
  id: EmployeeId,
  color: string,
  skin: MeshStandardMaterial,
  hair: MeshStandardMaterial,
  ink: MeshStandardMaterial,
): Actor {
  const cloth = material(color);
  const group = new Group();
  group.name = id;
  group.userData.employee = id;
  const bob = new Group();
  const tilt = new Group();
  group.add(bob);
  bob.add(tilt);
  if (id === "maya") bob.scale.set(1.02, 1.14, 1.02);
  if (id === "rex") bob.scale.set(1.04, 0.9, 1.04);

  const body = new Mesh(new CapsuleGeometry(0.26, 0.46, 2, 7), cloth);
  body.position.y = 0.95;
  body.castShadow = true;
  tilt.add(body);

  const head = new Group();
  head.position.y = 1.5;
  const skull = new Mesh(new SphereGeometry(0.22, 7, 6), skin);
  skull.castShadow = true;
  head.add(skull);
  const eyeGeo = new SphereGeometry(0.035, 5, 4);
  for (const side of [-0.08, 0.08]) {
    const eye = new Mesh(eyeGeo, ink);
    eye.position.set(side, 0.03, 0.19);
    head.add(eye);
  }
  tilt.add(head);
  personality(id, head, color, hair, cloth);

  const leftArm = limb(cloth, 0.07, 0.34);
  const rightArm = limb(cloth, 0.07, 0.34);
  leftArm.position.set(-0.34, 1.18, 0);
  rightArm.position.set(0.34, 1.18, 0);
  tilt.add(leftArm, rightArm);
  const leftLeg = limb(cloth, 0.08, 0.32);
  const rightLeg = limb(cloth, 0.08, 0.32);
  leftLeg.position.set(-0.12, 0.52, 0);
  rightLeg.position.set(0.12, 0.52, 0);
  tilt.add(leftLeg, rightLeg);

  const icon = workIcon(id, color);
  icon.visible = false;
  bob.add(icon);

  const nameTag = namePlate(id, color);
  bob.add(nameTag);

  const ok = badge("✓", "#2F7D6D");
  const bad = badge("!", "#B42318");
  ok.position.set(0.62, 1.45, 0);
  bad.position.set(0.62, 1.45, 0);
  bob.add(ok, bad);

  const dustMat = material("#D9D3C7");
  dustMat.transparent = true;
  dustMat.opacity = 0.4;
  const dust = [0, 1, 2].map(() => {
    const puff = new Mesh(new SphereGeometry(0.06, 5, 4), dustMat.clone());
    puff.visible = false;
    group.add(puff);
    return puff;
  });

  group.traverse((child) => {
    child.userData.employee = id;
  });

  return {
    id,
    group,
    bob,
    tilt,
    head,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    icon,
    ok,
    bad,
    anim: "idle",
    age: Math.random() * 3,
    hunch: id === "rex" ? 0.32 : 0,
    path: [],
    face: 0,
    deadline: 0,
    dust,
  };
}

function personality(
  id: EmployeeId,
  head: Group,
  color: string,
  hair: MeshStandardMaterial,
  cloth: MeshStandardMaterial,
): void {
  if (id === "rex") {
    const frame = material("#243044");
    for (const side of [-0.09, 0.09]) {
      const ring = new Mesh(new TorusGeometry(0.06, 0.012, 4, 8), frame);
      ring.position.set(side, 0.02, 0.18);
      head.add(ring);
    }
  }
  if (id === "luna") {
    const tail = new Mesh(new SphereGeometry(0.09, 6, 5), hair);
    tail.position.set(0.04, -0.02, -0.2);
    const puff = new Mesh(new SphereGeometry(0.13, 6, 5), hair);
    puff.position.set(0.08, -0.22, -0.26);
    head.add(tail, puff);
  }
  if (id === "victor") {
    const cap = material("#24312C");
    const crown = new Mesh(new CylinderGeometry(0.16, 0.2, 0.12, 6), cap);
    crown.position.y = 0.18;
    const brim = new Mesh(new CylinderGeometry(0.3, 0.3, 0.03, 6), cap);
    brim.position.y = 0.12;
    head.add(crown, brim);
  }
  if (id === "ivy") {
    const band = new Mesh(new TorusGeometry(0.24, 0.028, 4, 10), material("#241E33"));
    band.rotation.x = Math.PI / 2;
    const mic = new Mesh(new SphereGeometry(0.045, 5, 4), cloth);
    mic.position.set(0.22, -0.1, 0.12);
    head.add(band, mic);
  }
  void color;
}

function workIcon(id: EmployeeId, color: string): Object3D {
  const group = new Group();
  group.position.set(0.45, 2.05, 0);
  const mat = material(color);
  if (id === "rex") {
    for (let index = 0; index < 3; index += 1) {
      const bar = new Mesh(new CylinderGeometry(0.04, 0.04, 0.12 + index * 0.08, 5), mat);
      bar.position.set(index * 0.12, 0, 0);
      group.add(bar);
    }
  } else if (id === "luna") {
    const pen = new Mesh(new CylinderGeometry(0.03, 0.03, 0.42, 5), mat);
    pen.rotation.z = 0.6;
    group.add(pen);
  } else if (id === "victor") {
    group.add(new Mesh(new TorusGeometry(0.12, 0.03, 4, 8), mat));
  } else if (id === "ivy") {
    const horn = new Mesh(new ConeGeometry(0.1, 0.28, 5), mat);
    horn.rotation.z = -0.8;
    group.add(horn);
  } else {
    const board = new Mesh(new CylinderGeometry(0.12, 0.12, 0.04, 6), mat);
    board.rotation.x = Math.PI / 2;
    group.add(board);
  }
  return group;
}

function limb(cloth: MeshStandardMaterial, radius: number, length: number): Group {
  const pivot = new Group();
  const mesh = new Mesh(new CapsuleGeometry(radius, length, 2, 6), cloth);
  mesh.position.y = -length / 2;
  mesh.castShadow = true;
  pivot.add(mesh);
  return pivot;
}

function badge(text: string, color: string): CSS2DObject {
  const wrap = document.createElement("div");
  const el = document.createElement("div");
  el.className = "status-bubble";
  el.style.background = color;
  el.textContent = text;
  el.style.display = "none";
  wrap.appendChild(el);
  return new CSS2DObject(wrap);
}

function labelFor(id: EmployeeId): string {
  return EMPLOYEES.find((employee) => employee.id === id)?.name ?? id;
}

function namePlate(id: EmployeeId, color: string): CSS2DObject {
  const plate = document.createElement("div");
  plate.className = "plate";
  const steps = document.createElement("div");
  steps.className = "steps";
  for (const step of FLOW_STEPS) {
    if (step.employee !== id) continue;
    const row = document.createElement("div");
    row.className = "step";
    row.dataset.flow = String(step.n);
    row.style.setProperty("--step", color);
    if (step.whenActive) {
      row.dataset.when = "active";
      row.hidden = true;
    }
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = String(step.n);
    chip.style.background = color;
    const copy = document.createElement("span");
    copy.className = "step-copy";
    copy.append(document.createTextNode(step.title));
    if (step.detail) {
      const detail = document.createElement("small");
      detail.textContent = step.detail;
      copy.append(detail);
    }
    row.append(chip, copy);
    steps.append(row);
  }
  const pill = document.createElement("div");
  pill.className = "tag";
  pill.textContent = labelFor(id);
  pill.style.borderLeftColor = color;
  plate.append(steps, pill);
  const tag = new CSS2DObject(plate);
  tag.center.set(0.5, 1);
  tag.position.set(0, 2.28, 0);
  tag.renderOrder = 3;
  return tag;
}

function material(color: string): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0 });
}

function dampAngle(current: number, target: number, dt: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * Math.min(1, dt * 8);
}

export const STATION_LIST = Object.keys(STATIONS) as StationId[];
