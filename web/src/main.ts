import {
  Color,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from "three";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#view");
const boot = document.querySelector<HTMLElement>("#boot");
if (!canvas || !boot) {
  throw new Error("Missing canvas");
}

const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new Scene();
const fog = "#F6F5F1";
scene.background = new Color(fog);
scene.fog = new Fog(fog, 40, 90);

const camera = new PerspectiveCamera(42, 1, 0.1, 200);
camera.position.set(18, 24, 18);
camera.lookAt(0, 0, 0);

scene.add(new HemisphereLight("#fff6ea", "#d9d3c5", 1.1));

const floor = new Mesh(
  new PlaneGeometry(30, 30),
  new MeshStandardMaterial({ color: "#EDE9DF", flatShading: true, roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

resize();
window.addEventListener("resize", resize);

const context = renderer.getContext();
if (!context) {
  boot.textContent = "This browser could not start WebGL.";
} else {
  canvas.dataset.ready = "1";
  boot.dataset.state = "ready";
  renderer.render(scene, camera);
}
