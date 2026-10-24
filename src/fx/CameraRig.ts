import * as THREE from "three";

// Chase camera with FOV kick on speed/boost and trauma-based shake.
export class CameraRig {
  private trauma = 0;
  private calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private base = new THREE.Vector3(0, 3.1, 7.2);
  private target = new THREE.Vector3();
  private look = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera) {
    camera.position.copy(this.base);
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount * (this.calm ? 0.3 : 1));
  }

  update(dt: number, craftX: number, boosting: boolean, speedNorm: number): void {
    const k = 1 - Math.exp(-dt * 6);
    this.target.set(craftX * 0.55, 3.1 - speedNorm * 0.25, 7.2);
    this.base.lerp(this.target, k);

    const s = this.trauma * this.trauma;
    this.camera.position.copy(this.base);
    this.camera.position.x += (Math.random() * 2 - 1) * 0.4 * s;
    this.camera.position.y += (Math.random() * 2 - 1) * 0.3 * s;
    this.look.set(craftX * 0.7, 0.4, -22);
    this.camera.lookAt(this.look);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);

    // Narrow (portrait) views need a wider vertical FOV to keep all four lanes in frame.
    const narrow = Math.max(0, 1.2 - this.camera.aspect) * 25;
    const fov = 60 + narrow + speedNorm * 6 + (boosting ? 9 : 0);
    this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 4));
    this.camera.updateProjectionMatrix();
  }
}
