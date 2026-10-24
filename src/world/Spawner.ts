import * as THREE from "three";
import type { ModelAsset } from "../core/Assets";
import { BARRIER, CELL, CHECKPOINT, CRAFT, LASER, MAX_LATERAL, TRACK } from "../core/Config";
import { Rng } from "../core/Rng";
import { baseSpeed, cellChance, clamp, laserChance, laserGap, lerp, movingChance, rampAt, rowInterval } from "../systems/Difficulty";
import { Checkpoint } from "./Checkpoint";
import { bend } from "./CurvedWorld";

interface Barrier {
  s: number; // track position (world distance)
  x: number;
  amp: number; // > 0 for moving barriers
  freq: number;
  phase: number;
  hitAt: number; // time of impact, −1 if untouched
  passed: boolean;
}

interface Laser {
  s: number;
  gap: number; // current gap centre
  from: number; // gap slides between these lane centres (equal when static)
  to: number;
  width: number;
  freq: number;
  phase: number;
  hitAt: number;
  passed: boolean;
}

interface Cell {
  s: number;
  x: number;
}

export interface SpawnEvents {
  hit: "barrier" | "laser" | null;
  nearMisses: number;
  /** Signed side of the last close call (negative = obstacle on the left), for stereo panning. */
  nearMissDx: number;
  cells: number;
  /** Km number of a checkpoint gate crossed this frame, or 0. */
  checkpoint: number;
}

const MAX_BARRIERS = 96;
const MAX_CELLS = 64;
const MAX_BEAMS = 128;
const MAX_POSTS = 32;
// Red-orange: reads as danger and stays distinct from the magenta rails.
const BEAM_COLOR = new THREE.Color(0xff3b1a).multiplyScalar(4);

// Spawns obstacle rows and boost cells ahead of the craft. Each row keeps a "safe lane" that moves at
// most as far as the craft can travel before the next row arrives, so every layout is passable.
export class Spawner {
  readonly barrierMesh: THREE.InstancedMesh;
  readonly cellMesh: THREE.InstancedMesh;
  readonly beamMesh: THREE.InstancedMesh;
  readonly postMesh: THREE.InstancedMesh;
  readonly checkpoint = new Checkpoint();
  private barriers: Barrier[] = [];
  private lasers: Laser[] = [];
  private cells: Cell[] = [];
  private rng = new Rng(1);
  private origin = 0;
  private nextRow = 0;
  private safeLane = 1;
  private nextGate = Infinity;
  private lastGate = -Infinity;
  private gateKm = 1;
  private active = false;
  private cellMaterial: THREE.MeshStandardMaterial;
  private beamMaterial: THREE.MeshBasicMaterial;
  private dummy = new THREE.Object3D();

  constructor(barrier: ModelAsset, cell: ModelAsset) {
    this.barrierMesh = new THREE.InstancedMesh(barrier.geometry, barrier.material, MAX_BARRIERS);
    this.cellMesh = new THREE.InstancedMesh(cell.geometry, cell.material, MAX_CELLS);
    this.cellMaterial = cell.material;
    const cube = new THREE.BoxGeometry(1, 1, 1);
    this.beamMaterial = bend(new THREE.MeshBasicMaterial({ color: BEAM_COLOR.clone() }));
    this.beamMesh = new THREE.InstancedMesh(cube, this.beamMaterial, MAX_BEAMS);
    const postMaterial = bend(new THREE.MeshStandardMaterial({ color: 0x1a1226, metalness: 0.6, roughness: 0.4, emissive: 0xff3b1a, emissiveIntensity: 0.5 }));
    this.postMesh = new THREE.InstancedMesh(cube.clone().translate(0, 0.5, 0), postMaterial, MAX_POSTS);
    for (const m of [this.barrierMesh, this.cellMesh, this.beamMesh, this.postMesh]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
    }
  }

  get objects(): THREE.Object3D[] {
    return [this.barrierMesh, this.cellMesh, this.beamMesh, this.postMesh, this.checkpoint.group];
  }

  /** Start spawning for a new run; difficulty is measured from `distance`. */
  reset(seed: number, distance: number): void {
    this.barriers = [];
    this.lasers = [];
    this.cells = [];
    this.rng = new Rng(seed);
    this.origin = distance;
    this.nextRow = distance + 110;
    this.safeLane = this.rng.int(1, 2);
    this.nextGate = distance + CHECKPOINT.every;
    this.lastGate = -Infinity;
    this.gateKm = 1;
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  /** Next safe lane: at most as many lanes away as the craft can cross in `interval` seconds. */
  private shiftSafeLane(interval: number): void {
    const reach = MAX_LATERAL * Math.max(0, interval - 0.3) * 0.7;
    const maxShift = clamp(Math.floor(reach / TRACK.laneWidth), 0, 3);
    this.safeLane = clamp(this.safeLane + this.rng.int(-maxShift, maxShift), 0, 3);
  }

  private emitRow(): void {
    const rng = this.rng;
    let s = this.nextRow;
    // Keep the road clear around a checkpoint gate.
    if (Math.abs(s - this.nextGate) < CHECKPOINT.clear) s = this.nextGate + CHECKPOINT.clear;
    const ramp = rampAt(s - this.origin);
    let interval = rowInterval(ramp);
    const roll = rng.next();
    const moving = movingChance(ramp);

    if (roll < moving) {
      this.barriers.push({ s, x: 0, amp: rng.range(2.5, 4.5), freq: rng.range(1.1, 1.8) + ramp, phase: rng.range(0, Math.PI * 2), hitAt: -1, passed: false });
      interval *= 1.35; // extra room to recover after dodging a moving barrier
    } else if (roll < moving + laserChance(ramp)) {
      this.shiftSafeLane(interval);
      const from = TRACK.lanes[this.safeLane];
      let to = from;
      if (ramp > 0.4 && rng.next() < 0.5) {
        // Sliding gap: oscillates between the safe lane and a neighbour.
        const dir = this.safeLane === 0 ? 1 : this.safeLane === 3 ? -1 : rng.next() < 0.5 ? -1 : 1;
        to = TRACK.lanes[this.safeLane + dir];
        interval *= 1.2;
      }
      this.lasers.push({ s, gap: from, from, to, width: laserGap(ramp), freq: rng.range(0.8, 1.4) + ramp * 0.6, phase: rng.range(0, Math.PI * 2), hitAt: -1, passed: false });
    } else {
      this.shiftSafeLane(interval);
      const count = Math.round(clamp(1 + ramp * 2.2 + rng.range(-0.6, 0.6), 1, 3));
      const blocked = rng.shuffle([0, 1, 2, 3].filter((l) => l !== this.safeLane)).slice(0, count);
      for (const lane of blocked) {
        this.barriers.push({ s, x: TRACK.lanes[lane], amp: 0, freq: 0, phase: 0, hitAt: -1, passed: false });
      }
    }

    const spacing = baseSpeed(s - this.origin) * interval;
    if (rng.next() < cellChance(ramp)) {
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++) this.cells.push({ s: s + spacing * (0.35 + i * 0.12), x: TRACK.lanes[this.safeLane] });
    }
    this.nextRow = s + spacing;
  }

  update(distance: number, time: number, craftX: number, collide: boolean, invulnerable: boolean): SpawnEvents {
    const events: SpawnEvents = { hit: null, nearMisses: 0, nearMissDx: 0, cells: 0, checkpoint: 0 };
    if (this.active) while (this.nextRow < distance + TRACK.far) this.emitRow();

    if (this.active && distance >= this.nextGate) {
      events.checkpoint = this.gateKm++;
      this.lastGate = this.nextGate;
      this.nextGate += CHECKPOINT.every;
    }

    const reachX = BARRIER.hitHalfWidth + CRAFT.hitHalfWidth;
    const reachZ = BARRIER.hitHalfLength + CRAFT.hitHalfLength;
    for (const b of this.barriers) {
      if (b.amp > 0) b.x = clamp(b.amp * Math.sin(b.freq * time + b.phase), -4.5, 4.5);
      if (!collide || b.hitAt >= 0) continue;
      const dz = b.s - distance;
      const dx = Math.abs(b.x - craftX);
      if (!invulnerable && !events.hit && Math.abs(dz) < reachZ && dx < reachX) {
        b.hitAt = time;
        events.hit = "barrier";
      } else if (!b.passed && dz < 0) {
        b.passed = true;
        if (!invulnerable && dx < reachX + BARRIER.nearMissMargin) {
          events.nearMisses++;
          events.nearMissDx = b.x - craftX;
        }
      }
    }

    for (const l of this.lasers) {
      if (l.from !== l.to) l.gap = lerp(l.from, l.to, 0.5 - 0.5 * Math.cos(l.freq * time + l.phase));
      if (!collide || l.hitAt >= 0) continue;
      const dz = l.s - distance;
      // Clearance between the craft's sides and the gap edges (negative = touching a beam).
      const left = craftX - CRAFT.hitHalfWidth - (l.gap - l.width / 2);
      const right = l.gap + l.width / 2 - (craftX + CRAFT.hitHalfWidth);
      const inGap = left > 0 && right > 0;
      if (!invulnerable && !events.hit && Math.abs(dz) < LASER.hitHalfLength + CRAFT.hitHalfLength && !inGap) {
        l.hitAt = time;
        events.hit = "laser";
      } else if (!l.passed && dz < 0) {
        l.passed = true;
        if (!invulnerable && inGap && Math.min(left, right) < LASER.closeMargin) {
          events.nearMisses++;
          events.nearMissDx = left < right ? -2 : 2;
        }
      }
    }

    // Passed obstacles go just behind the craft (they would fill the screen between craft and camera);
    // knocked barriers stay a little longer to finish tumbling away.
    this.barriers = this.barriers.filter((b) => b.s > distance - (b.hitAt >= 0 ? 12 : 3));
    this.lasers = this.lasers.filter((l) => l.s > distance - 3);

    if (collide) {
      this.cells = this.cells.filter((c) => {
        const taken = Math.abs(c.s - distance) < CELL.pickupRadius && Math.abs(c.x - craftX) < CELL.pickupRadius;
        if (taken) events.cells++;
        return !taken;
      });
    }
    this.cells = this.cells.filter((c) => c.s > distance - 12);

    this.render(distance, time);
    return events;
  }

  private render(distance: number, time: number): void {
    const o = this.dummy;
    let n = 0;
    for (const b of this.barriers) {
      if (n >= MAX_BARRIERS) break;
      o.position.set(b.x, 0, distance - b.s);
      o.rotation.set(0, 0, 0);
      if (b.hitAt >= 0) {
        // Knocked away: arc up and tumble.
        const t = time - b.hitAt;
        o.position.y = Math.max(0, 12 * t - 6 * t * t);
        o.position.x += Math.sign(b.x || 1) * t * 14;
        o.rotation.set(t * 9, 0, t * 5);
      }
      o.updateMatrix();
      this.barrierMesh.setMatrixAt(n++, o.matrix);
    }
    this.barrierMesh.count = n;
    this.barrierMesh.instanceMatrix.needsUpdate = true;

    this.renderLasers(distance, time);

    n = 0;
    o.rotation.set(0, 0, 0);
    for (const c of this.cells) {
      if (n >= MAX_CELLS) break;
      o.position.set(c.x, CELL.height + Math.sin(time * 3 + c.s) * 0.2, distance - c.s);
      o.rotation.set(0, time * 2 + c.s * 0.1, 0);
      o.scale.setScalar(1 + Math.sin(time * 6) * 0.06);
      o.updateMatrix();
      this.cellMesh.setMatrixAt(n++, o.matrix);
    }
    o.scale.setScalar(1);
    this.cellMesh.count = n;
    this.cellMesh.instanceMatrix.needsUpdate = true;
    this.cellMaterial.emissiveIntensity = 1.4 + Math.sin(time * 5) * 0.5;

    // Show the upcoming gate, or the one just crossed until it's behind the camera.
    if (distance - this.lastGate < 10) this.checkpoint.place(this.gateKm - 1, distance - this.lastGate, time);
    else if (this.active && this.nextGate - distance < TRACK.far + 20) this.checkpoint.place(this.gateKm, distance - this.nextGate, time);
    else this.checkpoint.place(null, 0, time);
  }

  private renderLasers(distance: number, time: number): void {
    const o = this.dummy;
    o.rotation.set(0, 0, 0);
    let beams = 0;
    let posts = 0;
    const edge = TRACK.halfWidth + 0.2;
    const put = (x: number, y: number, z: number, sx: number, sy: number, sz = sy) => {
      if (beams >= MAX_BEAMS) return;
      o.position.set(x, y, z);
      o.scale.set(sx, sy, sz);
      o.updateMatrix();
      this.beamMesh.setMatrixAt(beams++, o.matrix);
    };
    const segment = (a: number, b: number, y: number, z: number) => {
      if (b - a > 0.05) put((a + b) / 2, y, z, b - a, 0.16);
    };
    // Glowing line on the road under the beams, so a fence reads from far away.
    const floor = (a: number, b: number, z: number) => {
      if (b - a > 0.05) put((a + b) / 2, 0.02, z, b - a, 0.02, 0.5);
    };

    for (const l of this.lasers) {
      const z = distance - l.s;
      for (const side of [-1, 1]) {
        if (posts >= MAX_POSTS) break;
        o.position.set(side * (TRACK.halfWidth + 0.35), 0, z);
        o.scale.set(0.35, 1.7, 0.35);
        o.updateMatrix();
        this.postMesh.setMatrixAt(posts++, o.matrix);
      }
      if (l.hitAt >= 0 && time - l.hitAt > 0.12) continue; // beams cut out after a short flash
      const lo = clamp(l.gap - l.width / 2, -edge, edge);
      const hi = clamp(l.gap + l.width / 2, -edge, edge);
      floor(-edge, lo, z);
      floor(hi, edge, z);
      for (const y of LASER.heights) {
        segment(-edge, lo, y, z);
        segment(hi, edge, y, z);
        // Emitter nodes mark the gap edges.
        if (lo > -edge) put(lo, y, z, 0.22, 0.22);
        if (hi < edge) put(hi, y, z, 0.22, 0.22);
      }
    }
    o.scale.setScalar(1);
    this.beamMesh.count = beams;
    this.beamMesh.instanceMatrix.needsUpdate = true;
    this.postMesh.count = posts;
    this.postMesh.instanceMatrix.needsUpdate = true;
    this.beamMaterial.color.copy(BEAM_COLOR).multiplyScalar(0.85 + 0.15 * Math.sin(time * 40));
  }
}
