import { BoxGeometry, Color, Mesh, MeshStandardMaterial, Scene, Vector3 } from "three";

export type Handoff = {
  fly(from: Vector3, to: Vector3, fromColor: string, toColor: string, ms: number): Promise<void>;
};

export function createHandoff(scene: Scene): Handoff {
  const material = new MeshStandardMaterial({ color: "#F7F4EC", flatShading: true, roughness: 0.8 });
  const mesh = new Mesh(new BoxGeometry(0.28, 0.36, 0.06), material);
  mesh.visible = false;
  mesh.castShadow = true;
  scene.add(mesh);
  const startColor = new Color();
  const endColor = new Color();

  return {
    fly(from, to, fromColor, toColor, ms) {
      if (ms <= 0) return Promise.resolve();
      mesh.visible = true;
      startColor.set(fromColor);
      endColor.set(toColor);
      const started = performance.now();
      return new Promise((resolve) => {
        const step = (now: number) => {
          const t = Math.min(1, (now - started) / ms);
          mesh.position.lerpVectors(from, to, t);
          mesh.position.y = 1.3 + Math.sin(t * Math.PI) * 1.5;
          material.color.copy(startColor).lerp(endColor, t);
          if (t < 1) requestAnimationFrame(step);
          else {
            mesh.visible = false;
            resolve();
          }
        };
        requestAnimationFrame(step);
      });
    },
  };
}
