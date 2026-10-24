import * as THREE from "three";
import type { ModelAsset } from "../core/Assets";
import { CRAFT, TRACK } from "../core/Config";

const CYAN = new THREE.Color(0x00e5ff).multiplyScalar(1.6);
const HOT = new THREE.Color(0xff5ae6).multiplyScalar(2);
// Thruster nozzles in baked model space (nose at −Z, tail at +Z).
const THRUSTERS = [new THREE.Vector3(-0.65, 0.35, 1.45), new THREE.Vector3(0.65, 0.35, 1.45)];

export class Hovercraft {
  readonly group = new THREE.Group();
  x = 0;
  vx = 0;
  private body = new THREE.Group();
  private mesh: THREE.Mesh;
  private glows: THREE.Sprite[] = [];
  private pitch = 0;
  private wreck = 0;

  constructor(model: ModelAsset, glowTex: THREE.Texture) {
    this.mesh = new THREE.Mesh(model.geometry, model.material);
    this.body.add(this.mesh);
    for (const p of THRUSTERS) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: CYAN.clone(),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
        }),
      );
      sprite.position.copy(p);
      this.glows.push(sprite);
      this.body.add(sprite);
    }
    this.group.add(this.body);
  }

  /** World positions of the thruster nozzles, for the trail. */
  thrusters(out: THREE.Vector3[]): THREE.Vector3[] {
    this.body.updateWorldMatrix(true, false);
    return THRUSTERS.map((p, i) => (out[i] ?? (out[i] = new THREE.Vector3())).copy(p).applyMatrix4(this.body.matrixWorld));
  }

  reset(): void {
    this.wreck = 0;
    this.mesh.visible = true;
    this.glows.forEach((g) => (g.visible = true));
  }

  crash(): void {
    this.wreck = 0.0001;
    this.glows.forEach((g) => (g.visible = false));
  }

  /** Returns true when the craft scraped an edge rail this frame. */
  update(dt: number, steer: number, push: number, boosting: boolean, invuln: number, time: number, speedNorm: number): boolean {
    if (this.wreck > 0) {
      this.wreck += dt;
      this.vx *= Math.exp(-3 * dt);
      this.x += this.vx * dt;
      this.body.rotation.z += dt * 6 * Math.exp(-this.wreck * 1.5);
      this.body.position.y = Math.max(0.1, CRAFT.hover - this.wreck * 0.8);
      this.group.position.x = this.x;
      return false;
    }

    this.vx += (steer * CRAFT.accel + push) * dt;
    this.vx *= Math.exp(-(steer !== 0 ? CRAFT.dampSteer : CRAFT.dampCoast) * dt);
    this.x += this.vx * dt;
    const limit = TRACK.halfWidth - CRAFT.hitHalfWidth - 0.15;
    let scraped = false;
    if (Math.abs(this.x) > limit) {
      this.x = Math.sign(this.x) * limit;
      this.vx = -this.vx * CRAFT.railBounce;
      scraped = true;
    }

    const ease = 1 - Math.exp(-dt * 10);
    this.pitch += ((boosting ? 0.06 : 0) - this.pitch) * ease;
    this.group.position.x = this.x;
    this.body.position.y = CRAFT.hover + Math.sin(time * 5) * 0.05 + Math.sin(time * 2.3) * 0.03;
    this.body.rotation.set(this.pitch, -this.vx * 0.012, -this.vx * 0.035 - steer * 0.08);

    this.mesh.visible = invuln <= 0 || Math.floor(time * 14) % 2 === 0;
    const size = 0.45 + speedNorm * 0.25 + (boosting ? 0.35 : 0) + Math.random() * 0.08;
    for (const g of this.glows) {
      g.scale.setScalar(size);
      g.material.color.copy(boosting ? HOT : CYAN);
    }
    return scraped;
  }
}
