import { HULL } from "../core/Config";
import type { Best } from "../systems/Save";

const $ = (id: string) => document.getElementById(id)!;
const fmt = (n: number) => Math.floor(n).toLocaleString("en-US");
export const fmtDistance = (m: number) => (m < 1000 ? `${Math.floor(m)} m` : `${(m / 1000).toFixed(2)} km`);

const touch = matchMedia("(pointer: coarse)").matches;

export interface HudStats {
  score: number;
  distance: number;
  speed: number;
  speedNorm: number;
  hull: number;
  boost: number;
  boosting: boolean;
}

export interface RunResult {
  score: number;
  distance: number;
  nearMisses: number;
  cells: number;
}

const CONTROLS = touch
  ? `<dl class="controls">
      <div><dd>Hold the left or right side to steer</dd></div>
      <div><dd>Two fingers to boost</dd></div>
    </dl>`
  : `<dl class="controls">
      <div><dt><kbd>A</kbd><kbd>D</kbd></dt><dd>or</dd><dt><kbd>←</kbd><kbd>→</kbd></dt><dd>Steer</dd></div>
      <div><dt><kbd>Shift</kbd></dt><dd>Boost</dd></div>
      <div><dt><kbd>Esc</kbd></dt><dd>Pause</dd></div>
    </dl>`;

const button = (label: string, key: string, action: string, secondary = false) =>
  `<button class="btn${secondary ? " secondary" : ""}" data-action="${action}" type="button"><span>${label}</span>${touch ? "" : `<kbd>${key}</kbd>`}</button>`;

const soundLabel = (muted: boolean) => (muted ? "Sound off" : "Sound on");
const soundButton = (muted: boolean) =>
  `<button class="btn secondary sound" data-action="mute" type="button" aria-pressed="${!muted}"><span>${soundLabel(muted)}</span>${touch ? "" : "<kbd>M</kbd>"}</button>`;

export class Hud {
  private hud = $("hud");
  private cluster = $("cluster");
  private overlay = $("overlay");
  private panel = $("panel");
  private score = $("score");
  private dist = $("dist");
  private speed = $("speed");
  private boost = $("boost-fill");
  private hint = $("boost-hint");
  private hull = $("hull");
  private popups = $("popups");
  private banner = $("banner");
  private flash = $("flash");
  private pips: HTMLElement[] = [];
  private shown = { score: "", dist: "", speed: "", boost: "", hull: -1 };
  private hasBoosted = false;

  constructor() {
    for (let i = 0; i < HULL.max; i++) this.pips.push(this.hull.appendChild(document.createElement("i")));
    this.pips.forEach((p) => p.addEventListener("animationend", () => p.classList.remove("lost")));
    this.hint.textContent = touch ? "Two fingers to boost" : "Hold Shift to boost";
  }

  private showPanel(html: string): void {
    this.panel.innerHTML = html;
    this.overlay.classList.remove("hidden");
  }

  showTitle(best: Best, muted: boolean): void {
    this.hud.classList.add("hidden");
    this.showPanel(`
      <h1 class="wordmark">Neon Drift</h1>
      <div class="lane"></div>
      <p class="lede">Steer past barriers and laser fences, grab energy cells to boost, and see how far you get.</p>
      <div class="actions">
        ${button(touch ? "Tap to race" : "Race", "Enter", "start")}
        ${soundButton(muted)}
        ${best.score > 0 ? `<span class="best">Best run: <b>${fmt(best.score)}</b> points over <b>${fmtDistance(best.distance)}</b></span>` : ""}
      </div>
      ${CONTROLS}`);
  }

  showPause(muted: boolean): void {
    this.showPanel(`
      <h2 class="heading">Paused</h2>
      <div class="lane"></div>
      <div class="actions">
        ${button("Resume", "Esc", "pause")}
        ${button("Restart", "R", "restart", true)}
        ${soundButton(muted)}
      </div>
      ${CONTROLS}`);
  }

  showGameOver(run: RunResult, best: Best, newBest: boolean): void {
    this.hud.classList.add("hidden");
    this.showPanel(`
      <h2 class="heading">Wrecked at ${fmtDistance(run.distance)}</h2>
      <div class="lane"></div>
      <div class="stats">
        <div class="stat"><b>${fmt(run.score)}</b><span>points</span></div>
        <div class="stat"><b>${run.nearMisses}</b><span>close calls</span></div>
        <div class="stat"><b>${run.cells}</b><span>energy cells</span></div>
      </div>
      <div class="result">
        ${newBest ? `<span class="badge"><span>New best run</span></span>` : `<span class="best">Best run: <b>${fmt(best.score)}</b> points over <b>${fmtDistance(best.distance)}</b></span>`}
      </div>
      <div class="actions">${button("Race again", "Enter", "start")}</div>`);
  }

  setSound(muted: boolean): void {
    this.panel.querySelectorAll<HTMLButtonElement>(".sound").forEach((b) => {
      b.setAttribute("aria-pressed", String(!muted));
      b.querySelector("span")!.textContent = soundLabel(muted);
    });
  }

  showPlaying(): void {
    this.overlay.classList.add("hidden");
    this.hud.classList.remove("hidden");
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  showError(): void {
    this.showPanel(`
      <h2 class="heading">The game couldn't start</h2>
      <div class="lane"></div>
      <p class="error">Neon Drift needs WebGL 2. Turn on hardware acceleration in your browser settings, or open it in a current version of Chrome, Edge, Firefox or Safari.</p>`);
  }

  update(s: HudStats): void {
    const score = fmt(s.score);
    const dist = fmtDistance(s.distance);
    const speed = fmt(s.speed * 3.6);
    const boost = `${(s.boost * 100).toFixed(1)}%`;
    if (score !== this.shown.score) this.score.textContent = this.shown.score = score;
    if (dist !== this.shown.dist) this.dist.textContent = this.shown.dist = dist;
    if (speed !== this.shown.speed) this.speed.textContent = this.shown.speed = speed;
    if (boost !== this.shown.boost) this.boost.style.width = this.shown.boost = boost;
    this.cluster.style.setProperty("--s", s.speedNorm.toFixed(3));
    this.hud.classList.toggle("boosting", s.boosting);

    if (s.boosting) this.hasBoosted = true;
    this.hint.classList.toggle("show", !this.hasBoosted && !s.boosting && s.boost >= 0.25);

    if (s.hull !== this.shown.hull) {
      if (s.hull < this.shown.hull && this.pips[s.hull]) this.pips[s.hull].classList.add("lost");
      this.pips.forEach((p, i) => p.classList.toggle("on", i < s.hull));
      this.hull.classList.toggle("low", s.hull === 1);
      this.shown.hull = s.hull;
    }
  }

  /** Reset per-run display state (hull pips start full without a "lost" flash). */
  resetRun(): void {
    this.shown.hull = -1;
  }

  popup(text: string, kind: "close" | "cell" | "info"): void {
    const el = document.createElement("div");
    el.className = `pop ${kind}`;
    el.textContent = text;
    el.addEventListener("animationend", () => el.remove());
    this.popups.appendChild(el);
    while (this.popups.childElementCount > 3) this.popups.firstElementChild?.remove();
  }

  milestone(km: number): void {
    this.banner.innerHTML = `<span>${km} km</span>`;
    this.banner.classList.remove("show");
    void this.banner.offsetWidth; // restart the animation
    this.banner.classList.add("show");
  }

  flashHit(): void {
    this.flash.classList.add("on");
    requestAnimationFrame(() => requestAnimationFrame(() => this.flash.classList.remove("on")));
  }
}
