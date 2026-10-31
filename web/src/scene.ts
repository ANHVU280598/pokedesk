import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Intersection,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { PALETTE, STATIONS, type StationId } from "@pulse/shared";
import { mountOperationFlow } from "./flow";

export type ThemeMode = "light" | "dark";

const RADIUS_MIN = 8;
const RADIUS_MAX = 40;
const DEFAULT_PHI = MathUtils.degToRad(55);
const DEFAULT_THETA = MathUtils.degToRad(38);
const DEFAULT_RADIUS = 34;

type Tone = "floor" | "grid" | "wood" | "paper" | "metal" | "ink";

const TONES: Record<ThemeMode, Record<Tone, string>> = {
  light: {
    floor: PALETTE.light.floor,
    grid: PALETTE.light.grid,
    wood: "#D7CBB8",
    paper: "#F7F4EC",
    metal: "#B7B1A6",
    ink: "#1D1D1B",
  },
  dark: {
    floor: PALETTE.dark.floor,
    grid: PALETTE.dark.grid,
    wood: "#3C414C",
    paper: "#D9D4C8",
    metal: "#8E95A3",
    ink: "#ECEBE6",
  },
};

export type Office = {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  actorRoot: Group;
  update(dt: number): void;
  render(): void;
  resize(): void;
  setTheme(mode: ThemeMode): void;
  resetView(): void;
  raycast(clientX: number, clientY: number, objects: Object3D[]): Intersection[];
  project(point: Vector3): { x: number; y: number; visible: boolean };
  follow(point: Vector3 | null, radius?: number): void;
  track(point: Vector3): void;
  setTapHandler(handler: (clientX: number, clientY: number) => void): void;
  nudge(theta: number, phi: number, radius: number): void;
  stats(): { calls: number; radius: number; phi: number; theta: number };
};

export function createOffice(canvas: HTMLCanvasElement): Office {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: (window.devicePixelRatio || 1) < 1.5,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  const camera = new PerspectiveCamera(48, 1, 0.1, 180);
  const actorRoot = new Group();
  scene.add(actorRoot);

  const hemi = new HemisphereLight("#fff6ea", "#d5cfc2", 0.82);
  scene.add(hemi);
  const sun = new DirectionalLight("#fff4e5", 1.2);
  sun.position.set(14, 24, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 70;
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  const materials = new Map<Tone, MeshStandardMaterial>();
  for (const tone of Object.keys(TONES.light) as Tone[]) {
    materials.set(tone, standard(TONES.light[tone]));
  }

  const floor = new Mesh(new RoundedBoxGeometry(30, 0.46, 30, 2, 0.55), materials.get("floor")!);
  floor.position.y = -0.23;
  floor.receiveShadow = true;
  floor.name = "floor";
  scene.add(floor);

  const gridGeo = new BoxGeometry(1, 0.012, 0.04);
  const grid = new InstancedMesh(gridGeo, materials.get("grid")!, 30);
  grid.receiveShadow = true;
  const dummy = new Object3D();
  let slot = 0;
  for (let line = -14; line <= 14; line += 2) {
    dummy.position.set(0, 0.02, line);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(28, 1, 1);
    dummy.updateMatrix();
    grid.setMatrixAt(slot++, dummy.matrix);
    dummy.position.set(line, 0.02, 0);
    dummy.rotation.set(0, Math.PI / 2, 0);
    dummy.scale.set(28, 1, 1);
    dummy.updateMatrix();
    grid.setMatrixAt(slot++, dummy.matrix);
  }
  grid.instanceMatrix.needsUpdate = true;
  scene.add(grid);

  const zoneGeo = new BoxGeometry(1, 0.035, 1);
  const zones: Mesh[] = [];
  const zoneSize: Record<StationId, [number, number]> = {
    planning: [8.4, 5.4],
    data: [6.4, 5.6],
    writing: [6.2, 5.2],
    factcheck: [6.2, 5.2],
    growth: [6.4, 5.6],
    outbox: [2.4, 1.8],
  };
  (Object.keys(STATIONS) as StationId[]).forEach((id) => {
    const station = STATIONS[id];
    const [w, d] = zoneSize[id];
    const zoneMat = standard(station.color);
    zoneMat.transparent = true;
    zoneMat.opacity = id === "outbox" ? 0.28 : 0.42;
    zoneMat.depthWrite = false;
    const zone = new Mesh(zoneGeo, zoneMat);
    zone.scale.set(w, 1, d);
    zone.position.set(station.x, 0.03, station.z);
    zone.renderOrder = 1;
    scene.add(zone);
    zones.push(zone);
  });

  const propRoot = new Group();
  scene.add(propRoot);
  const animated = buildProps(propRoot, materials);
  const flow = mountOperationFlow(scene);

  const target = new Vector3(0, 0.2, 0);
  const desiredTarget = target.clone();
  const homeTarget = target.clone();
  let theta = DEFAULT_THETA;
  let phi = DEFAULT_PHI;
  let radius = DEFAULT_RADIUS;
  let desiredTheta = theta;
  let desiredPhi = phi;
  let desiredRadius = radius;
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStart = 0;
  let pinchRadius = radius;
  let dragged = 0;
  let tapHandler: ((clientX: number, clientY: number) => void) | null = null;
  const clock = { t: 0 };

  function placeCamera(): void {
    const sin = Math.sin(phi);
    camera.position.set(
      target.x + radius * sin * Math.sin(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * sin * Math.cos(theta),
    );
    camera.lookAt(target);
  }

  function resize(): void {
    const width = window.innerWidth;
    const height = Math.max(window.innerHeight, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const span = width < 520 ? 34 : 46;
    const dist = width < 520 ? 40 : 36;
    const half = Math.atan(span / 2 / dist);
    const vfov = 2 * Math.atan(Math.tan(half) / Math.max(camera.aspect, 0.42));
    camera.fov = MathUtils.clamp(MathUtils.radToDeg(vfov), 36, width < 520 ? 74 : 58);
    camera.updateProjectionMatrix();
  }

  function setTheme(next: ThemeMode): void {
    const colors = TONES[next];
    const fog = next === "dark" ? PALETTE.dark.fog : PALETTE.light.fog;
    scene.background = new Color(fog);
    scene.fog = new Fog(fog, 28, 78);
    for (const tone of Object.keys(colors) as Tone[]) {
      materials.get(tone)?.color.set(colors[tone]);
    }
    if (next === "dark") {
      hemi.color.set("#c5d0e4");
      hemi.groundColor.set("#1a1d24");
      hemi.intensity = 0.7;
      sun.color.set("#d5def0");
      sun.intensity = 0.95;
    } else {
      hemi.color.set("#fff6ea");
      hemi.groundColor.set("#d5cfc2");
      hemi.intensity = 0.82;
      sun.color.set("#fff4e5");
      sun.intensity = 1.2;
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", fog);
    document.body.style.background = fog;
    flow.setTheme(next);
  }

  function clientNdc(clientX: number, clientY: number): Vector2 {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    return ndc;
  }

  canvas.addEventListener("pointerdown", (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
    dragged = 0;
    if (pointers.size === 2) {
      pinchStart = pointerSpan();
      pinchRadius = desiredRadius;
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dragged += Math.abs(dx) + Math.abs(dy);
    if (pointers.size >= 2 && pinchStart > 0) {
      const span = pointerSpan();
      desiredRadius = MathUtils.clamp(pinchRadius * (pinchStart / span), RADIUS_MIN, RADIUS_MAX);
      return;
    }
    desiredTheta -= dx * 0.005;
    desiredPhi = MathUtils.clamp(desiredPhi + dy * 0.0035, 0.42, 1.15);
  });
  const endPointer = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchStart = 0;
    if (dragged < 6 && event.type === "pointerup") {
      tapHandler?.(event.clientX, event.clientY);
    }
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const factor = Math.exp(event.deltaY * 0.0011);
      desiredRadius = MathUtils.clamp(desiredRadius * factor, RADIUS_MIN, RADIUS_MAX);
    },
    { passive: false },
  );

  function pointerSpan(): number {
    const pts = [...pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  function resetView(): void {
    desiredTarget.copy(homeTarget);
    desiredTheta = DEFAULT_THETA;
    desiredPhi = DEFAULT_PHI;
    desiredRadius = window.innerWidth < 520 ? 40 : DEFAULT_RADIUS;
  }

  function raycast(clientX: number, clientY: number, objects: Object3D[]): Intersection[] {
    raycaster.setFromCamera(clientNdc(clientX, clientY), camera);
    return raycaster.intersectObjects(objects, true);
  }

  function update(dt: number): void {
    clock.t += dt;
    const k = 1 - Math.pow(0.0015, dt);
    theta = lerpAngle(theta, desiredTheta, k);
    phi = MathUtils.lerp(phi, desiredPhi, k);
    radius = MathUtils.lerp(radius, desiredRadius, k);
    target.lerp(desiredTarget, k);
    placeCamera();
    animated(clock.t);
    flow.pulse(clock.t);
  }

  function render(): void {
    renderer.render(scene, camera);
  }

  setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  resize();
  resetView();
  radius = desiredRadius;
  theta = desiredTheta;
  phi = desiredPhi;
  placeCamera();

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", () => setTheme(media.matches ? "dark" : "light"));
  window.addEventListener("resize", resize);

  return {
    scene,
    camera,
    renderer,
    actorRoot,
    update,
    render,
    resize,
    setTheme,
    resetView,
    raycast,
    project(point: Vector3) {
      const vector = point.clone().project(camera);
      const width = window.innerWidth;
      const height = window.innerHeight;
      return {
        x: (vector.x * 0.5 + 0.5) * width,
        y: (-vector.y * 0.5 + 0.5) * height,
        visible: vector.z < 1,
      };
    },
    follow(point: Vector3 | null, nextRadius = 16) {
      if (!point) {
        resetView();
        return;
      }
      desiredTarget.copy(point);
      desiredTarget.y = 1;
      desiredRadius = MathUtils.clamp(nextRadius, RADIUS_MIN, RADIUS_MAX);
    },
    track(point: Vector3) {
      desiredTarget.copy(point);
      desiredTarget.y = 1.1;
    },
    setTapHandler(handler) {
      tapHandler = handler;
    },
    nudge(nextTheta, nextPhi, nextRadius) {
      desiredTheta = nextTheta;
      desiredPhi = nextPhi;
      desiredRadius = MathUtils.clamp(nextRadius, RADIUS_MIN, RADIUS_MAX);
    },
    stats() {
      return { calls: renderer.info.render.calls, radius, phi, theta };
    },
  };
}

function standard(color: string): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.94,
    metalness: 0,
  });
}

function buildProps(parent: Group, materials: Map<Tone, MeshStandardMaterial>): (time: number) => void {
  const wood = materials.get("wood")!;
  const paper = materials.get("paper")!;
  const metal = materials.get("metal")!;
  const ink = materials.get("ink")!;
  const stickies: Mesh[] = [];
  const bars: Mesh[] = [];
  const lines: Mesh[] = [];
  const rising: Mesh[] = [];
  let stamp: Mesh | null = null;

  whiteboard(parent, stickies, paper, ink);
  monitors(parent, bars, wood, ink);
  writingDesk(parent, lines, wood, metal, ink);
  booth(parent, wood, metal, (mesh) => {
    stamp = mesh;
  });
  growthDesk(parent, rising, wood, metal);
  outbox(parent, wood, paper);

  return (time: number) => {
    stickies.forEach((note, index) => {
      note.position.y = note.userData.baseY + Math.sin(time * 0.9 + index) * 0.035;
    });
    bars.forEach((bar, index) => {
      const scale = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * 1.7 + index * 0.7));
      bar.scale.y = scale;
      bar.position.y = bar.userData.baseY + (scale - 1) * 0.16;
    });
    lines.forEach((line, index) => {
      line.position.y = line.userData.baseY + Math.sin(time * 1.3 + index * 0.8) * 0.06;
    });
    rising.forEach((bar, index) => {
      const scale = 0.4 + ((index + 1) / rising.length) * (0.7 + 0.3 * Math.sin(time * 1.1));
      bar.scale.y = scale;
      bar.position.y = 0.02 + scale * 0.28;
    });
    if (stamp) {
      const cycle = time % 2.6;
      stamp.position.y = cycle < 0.12 ? 0.72 : 1.08;
    }
  };
}

function addBox(
  parent: Object3D,
  size: [number, number, number],
  material: MeshStandardMaterial,
  position: [number, number, number],
): Mesh {
  const mesh = new Mesh(new BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function desk(parent: Group, x: number, z: number, material: MeshStandardMaterial): Group {
  const group = new Group();
  group.position.set(x, 0, z);
  addBox(group, [2.3, 0.1, 1.12], material, [0, 0.78, 0]);
  for (const [lx, lz] of [
    [-1.0, -0.42],
    [1.0, -0.42],
    [-1.0, 0.42],
    [1.0, 0.42],
  ] as const) {
    addBox(group, [0.09, 0.74, 0.09], material, [lx, 0.37, lz]);
  }
  parent.add(group);
  return group;
}

function whiteboard(parent: Group, stickies: Mesh[], paper: MeshStandardMaterial, ink: MeshStandardMaterial): void {
  const board = STATIONS.planning;
  addBox(parent, [0.12, 1.5, 0.12], ink, [board.x - 1.45, 0.75, board.z - 1.7]);
  addBox(parent, [0.12, 1.5, 0.12], ink, [board.x + 1.45, 0.75, board.z - 1.7]);
  addBox(parent, [3.3, 1.9, 0.1], paper, [board.x, 1.55, board.z - 1.7]);
  const colors = ["#F2C14E", "#E07A5F", "#7EB6D9"];
  colors.forEach((color, index) => {
    const note = addBox(parent, [0.62, 0.5, 0.04], standard(color), [
      board.x - 0.9 + index * 0.85,
      1.7 - (index % 2) * 0.45,
      board.z - 1.62,
    ]);
    note.userData.baseY = note.position.y;
    stickies.push(note);
  });
}

function monitors(parent: Group, bars: Mesh[], wood: MeshStandardMaterial, ink: MeshStandardMaterial): void {
  const station = STATIONS.data;
  const table = desk(parent, station.x - 0.2, station.z + 0.2, wood);
  for (const side of [-0.55, 0.55]) {
    addBox(table, [0.08, 0.28, 0.08], ink, [side, 1.0, 0]);
    const screen = addBox(table, [0.92, 0.58, 0.06], standard("#1B2430"), [side, 1.32, 0]);
    screen.castShadow = true;
  }
  for (let index = 0; index < 4; index += 1) {
    const bar = addBox(table, [0.16, 0.32, 0.16], standard("#F0A05A"), [-0.55 + index * 0.22, 0.95, 0.42]);
    bar.userData.baseY = bar.position.y;
    bars.push(bar);
  }
}

function writingDesk(
  parent: Group,
  lines: Mesh[],
  wood: MeshStandardMaterial,
  metal: MeshStandardMaterial,
  ink: MeshStandardMaterial,
): void {
  const station = STATIONS.writing;
  const table = desk(parent, station.x, station.z + 0.85, wood);
  addBox(table, [0.08, 0.55, 0.08], metal, [0.85, 1.15, -0.2]);
  const shade = new Mesh(new ConeGeometry(0.28, 0.32, 5), standard("#F2D16B"));
  shade.position.set(0.85, 1.5, -0.2);
  shade.castShadow = true;
  table.add(shade);
  const bulb = new Mesh(new SphereGeometry(0.08, 6, 5), standard("#FFF4CC"));
  bulb.position.set(0.85, 1.32, -0.2);
  table.add(bulb);
  for (let index = 0; index < 3; index += 1) {
    const line = addBox(table, [1.15, 0.035, 0.08], ink, [-0.15, 1.15 + index * 0.12, 0.15]);
    line.userData.baseY = line.position.y;
    lines.push(line);
  }
}

function booth(
  parent: Group,
  wood: MeshStandardMaterial,
  metal: MeshStandardMaterial,
  setStamp: (mesh: Mesh) => void,
): void {
  const station = STATIONS.factcheck;
  const table = desk(parent, station.x, station.z + 0.85, wood);
  const glass = new Mesh(new TorusGeometry(0.28, 0.05, 5, 10), metal);
  glass.position.set(-0.55, 1.15, 0.1);
  glass.rotation.x = Math.PI / 2.4;
  glass.castShadow = true;
  table.add(glass);
  addBox(table, [0.08, 0.34, 0.08], metal, [-0.28, 0.98, 0.22]);
  const stamp = new Mesh(new CylinderGeometry(0.18, 0.18, 0.22, 6), standard("#2F7D6D"));
  stamp.position.set(0.45, 1.08, 0.05);
  stamp.castShadow = true;
  table.add(stamp);
  setStamp(stamp);
}

function growthDesk(parent: Group, rising: Mesh[], wood: MeshStandardMaterial, metal: MeshStandardMaterial): void {
  const station = STATIONS.growth;
  const table = desk(parent, station.x + 0.15, station.z + 0.15, wood);
  const horn = new Mesh(new ConeGeometry(0.22, 0.7, 6), standard("#7A4FD1"));
  horn.position.set(-0.15, 1.15, 0);
  horn.rotation.z = Math.PI / 2.2;
  horn.castShadow = true;
  table.add(horn);
  addBox(table, [0.16, 0.16, 0.28], metal, [0.22, 1.05, 0]);
  for (let index = 0; index < 4; index += 1) {
    const bar = addBox(table, [0.16, 0.56, 0.16], standard("#CDB4F6"), [0.35 + index * 0.22, 0.3, 0.55]);
    rising.push(bar);
  }
}

function outbox(parent: Group, wood: MeshStandardMaterial, paper: MeshStandardMaterial): void {
  const station = STATIONS.outbox;
  addBox(parent, [1.7, 0.08, 1.25], wood, [station.x, 0.1, station.z]);
  addBox(parent, [1.7, 0.28, 0.08], wood, [station.x, 0.24, station.z - 0.58]);
  addBox(parent, [0.08, 0.28, 1.15], wood, [station.x - 0.81, 0.24, station.z]);
  addBox(parent, [0.08, 0.28, 1.15], wood, [station.x + 0.81, 0.24, station.z]);
  addBox(parent, [1.15, 0.02, 0.8], paper, [station.x, 0.18, station.z + 0.05]);
}

function lerpAngle(current: number, target: number, t: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * t;
}
