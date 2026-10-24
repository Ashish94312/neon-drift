import * as THREE from "three";
import { loadAssets } from "./Assets";
import { BOOST, CHECKPOINT, CRAFT, CURVE, HULL, SCORE, SPEED } from "./Config";
import { Input } from "./Input";
import { Hovercraft } from "../entities/Hovercraft";
import { CameraRig } from "../fx/CameraRig";
import { PostFX } from "../fx/PostFX";
import { Sound } from "../fx/Sound";
import { Trail } from "../fx/Trail";
import { baseSpeed, clamp, curveAmount, rampAt } from "../systems/Difficulty";
import { loadBest, saveBest } from "../systems/Save";
import { loadFonts } from "../ui/Fonts";
import { Hud } from "../ui/Hud";
import { curve } from "../world/CurvedWorld";
import { Environment } from "../world/Environment";
import { Spawner } from "../world/Spawner";
import { Track } from "../world/Track";

type State = "loading" | "title" | "playing" | "paused" | "over";

interface Run {
  distance: number;
  score: number;
  hull: number;
  boost: number;
  boosting: boolean;
  invuln: number;
  hitFactor: number;
  nearMisses: number;
  cells: number;
  overTime: number;
}

const freshRun = (): Run => ({
  distance: 0,
  score: 0,
  hull: HULL.max,
  boost: 0.25,
  boosting: false,
  invuln: 0,
  hitFactor: 1,
  nearMisses: 0,
  cells: 0,
  overTime: 0,
});

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1500);
  private input = new Input();
  private hud = new Hud();
  private rig = new CameraRig(this.camera);
  private trail = new Trail();
  private sound = new Sound();
  private fx: PostFX;
  private env!: Environment;
  private track!: Track;
  private craft!: Hovercraft;
  private spawner!: Spawner;

  private state: State = "loading";
  private run = freshRun();
  private best = loadBest();
  private world = 0; // total distance scrolled, never reset (keeps the world continuous)
  private speed = SPEED.title;
  private time = 0;
  private last = 0;
  private nozzles: THREE.Vector3[] = [];
  private wasBoosting = false;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);
    this.fx = new PostFX(this.renderer, this.scene, this.camera);
  }

  async init(): Promise<void> {
    try {
      const [assets] = await Promise.all([loadAssets(), loadFonts()]);
      this.env = new Environment(this.scene, this.renderer);
      this.track = new Track();
      this.craft = new Hovercraft(assets.craft, assets.glow);
      this.spawner = new Spawner(assets.barrier, assets.cell);
      this.scene.add(this.track.group, this.craft.group, ...this.spawner.objects, this.trail.points);
    } catch (err) {
      console.error(err);
      this.hud.showError();
      return;
    }
    addEventListener("resize", () => this.resize());
    this.resize();
    this.state = "title";
    this.hud.showTitle(this.best, this.sound.muted);
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  private resize(): void {
    const w = innerWidth;
    const h = innerHeight;
    const pr = Math.min(devicePixelRatio, 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.fx.setSize(w, h, pr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.env.setPixelScale(h * pr);
    this.trail.setPixelScale(h * pr);
  }

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    // rAF timestamps can precede the performance.now() taken at init/resume, so clamp at 0.
    const dt = clamp((now - this.last) / 1000, 0, 1 / 30);
    this.last = now;
    this.handleInput();
    if (this.state !== "paused") this.update(dt);
    this.fx.render();
    this.input.endFrame();
  };

  private handleInput(): void {
    const i = this.input;
    if (i.take("mute")) {
      const muted = this.sound.toggleMute();
      this.hud.setSound(muted);
      this.hud.popup(muted ? "Sound off" : "Sound on", "info");
    }
    switch (this.state) {
      case "title":
        if (i.take("start")) this.startRun();
        break;
      case "over":
        if (this.run.overTime > 1 && i.take("start")) this.startRun();
        break;
      case "playing":
        if (i.take("pause") || i.take("blur")) {
          this.state = "paused";
          this.sound.setMode("paused");
          this.hud.showPause(this.sound.muted);
        }
        break;
      case "paused":
        if (i.take("restart")) {
          this.startRun();
          this.last = performance.now();
        } else if (i.take("pause") || i.take("start")) {
          this.state = "playing";
          this.sound.setMode("race");
          this.hud.showPlaying();
          this.last = performance.now();
        }
        break;
    }
  }

  private startRun(): void {
    this.run = freshRun();
    this.spawner.reset((Math.random() * 2 ** 32) >>> 0, this.world);
    this.craft.reset();
    this.hud.resetRun();
    this.sound.confirm();
    this.sound.setMode("race");
    this.wasBoosting = false;
    this.state = "playing";
    this.hud.showPlaying();
  }

  private gameOver(): void {
    const r = this.run;
    this.state = "over";
    r.boosting = false;
    this.craft.crash();
    this.spawner.stop();
    this.sound.wreck();
    this.sound.setMode("over");
    this.rig.shake(1);
    const newBest = r.score > this.best.score;
    this.best = { score: Math.max(this.best.score, r.score), distance: Math.max(this.best.distance, r.distance) };
    saveBest(this.best);
    setTimeout(() => this.hud.showGameOver(r, this.best, newBest), 900);
  }

  private update(dt: number): void {
    const r = this.run;
    const playing = this.state === "playing";
    this.time += dt;

    let steer = 0;
    if (playing) {
      r.hitFactor = Math.min(1, r.hitFactor + SPEED.recover * dt);
      r.boosting = this.input.boost && r.boost > 0;
      if (r.boosting) r.boost = Math.max(0, r.boost - BOOST.drain * dt);
      const target = baseSpeed(r.distance) * (r.boosting ? SPEED.boost : 1) * r.hitFactor;
      this.speed += (target - this.speed) * Math.min(1, dt * 3);
      steer = this.input.steer;
    } else if (this.state === "title") {
      this.speed += (SPEED.title - this.speed) * Math.min(1, dt * 2);
      steer = clamp((Math.sin(this.time * 0.5) * 3 - this.craft.x) * 0.5, -1, 1); // attract-mode autopilot
    } else {
      this.speed *= Math.exp(-dt * 2.2);
      r.overTime += dt;
    }

    const step = this.speed * dt;
    this.world += step;
    if (playing) r.distance += step;

    // Bend the world; amplitude grows with the run's difficulty.
    const w = this.world;
    const amp = curveAmount(rampAt(r.distance));
    curve.value.set(amp * (0.65 * Math.sin(w * 0.0019) + 0.35 * Math.sin(w * 0.0047 + 1.3)), CURVE.rise * Math.sin(w * 0.0013 + 0.7));
    const push = playing ? -(curve.value.x / CURVE.max) * CURVE.push : 0;

    const speedNorm = clamp((this.speed - 20) / 50, 0, 1);
    const scraped = this.craft.update(dt, steer, push, r.boosting, r.invuln, this.time, speedNorm);

    const events = this.spawner.update(this.world, this.time, this.craft.x, playing, r.invuln > 0);
    if (playing) {
      r.invuln = Math.max(0, r.invuln - dt);
      r.score += step * (r.boosting ? SCORE.boostMultiplier : 1);
      if (scraped) {
        r.hitFactor = Math.max(0.6, r.hitFactor - CRAFT.railScrape);
        this.rig.shake(0.12);
        this.sound.scrape();
      }
      if (r.boosting && !this.wasBoosting) this.sound.boost();
      this.wasBoosting = r.boosting;
      if (events.nearMisses) {
        r.nearMisses += events.nearMisses;
        r.score += SCORE.nearMiss * events.nearMisses;
        this.hud.popup(`Close call +${SCORE.nearMiss * events.nearMisses}`, "close");
        this.sound.closeCall(events.nearMissDx);
      }
      if (events.cells) {
        r.boost = Math.min(1, r.boost + BOOST.perCell * events.cells);
        r.score += SCORE.cell * events.cells;
        r.cells += events.cells;
        this.hud.popup(`Energy cell +${SCORE.cell * events.cells}`, "cell");
        this.sound.pickup();
      }
      if (events.checkpoint) this.onCheckpoint(events.checkpoint);
      if (events.hit) this.onHit(events.hit);
    }

    if (this.state !== "over" || r.overTime < 0.3) {
      for (const p of this.craft.thrusters(this.nozzles)) this.trail.emit(p);
    }
    this.trail.update(dt, this.speed, r.boosting);
    this.track.update(this.world, this.craft.x, 0.3 + (r.boosting ? 0.4 : 0) + speedNorm * 0.15);
    this.rig.update(dt, this.craft.x, r.boosting, speedNorm);
    this.env.update(this.world, this.camera);
    this.sound.update(speedNorm, r.boosting);
    if (playing) this.hud.update({ score: r.score, distance: r.distance, speed: this.speed, speedNorm, hull: r.hull, boost: r.boost, boosting: r.boosting });
  }

  private onCheckpoint(km: number): void {
    const r = this.run;
    r.score += CHECKPOINT.bonus;
    r.boost = Math.min(1, r.boost + CHECKPOINT.boost);
    this.hud.milestone(km);
    this.hud.popup(`Checkpoint +${CHECKPOINT.bonus}`, "cell");
    if (r.hull < HULL.max) {
      r.hull += 1;
      this.hud.popup("Hull repaired", "info");
    }
    this.sound.milestone();
  }

  private onHit(kind: "barrier" | "laser"): void {
    const r = this.run;
    r.hull -= 1;
    r.invuln = HULL.invuln;
    r.hitFactor = 1 - SPEED.hitPenalty;
    this.speed *= 1 - SPEED.hitPenalty;
    this.rig.shake(0.7);
    this.hud.flashHit();
    this.hud.update({ score: r.score, distance: r.distance, speed: this.speed, speedNorm: 0, hull: r.hull, boost: r.boost, boosting: false });
    if (kind === "laser") this.sound.zap();
    if (r.hull <= 0) this.gameOver();
    else this.sound.hit();
  }
}
