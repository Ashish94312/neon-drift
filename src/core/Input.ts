export type Action = "start" | "pause" | "restart" | "mute" | "blur";

const LEFT = ["ArrowLeft", "KeyA"];
const RIGHT = ["ArrowRight", "KeyD"];
const BOOST = ["ShiftLeft", "ShiftRight", "Space"];
const CAPTURED = new Set([...LEFT, ...RIGHT, ...BOOST, "ArrowUp", "ArrowDown"]);

// Keyboard + touch. Touch: hold left/right half of the screen to steer, two fingers to boost.
export class Input {
  private keys = new Set<string>();
  private actions = new Set<Action>();
  private touches = new Map<number, number>();

  constructor() {
    addEventListener("keydown", (e) => {
      if (CAPTURED.has(e.code)) e.preventDefault();
      if (!e.repeat) {
        if (e.code === "Enter" || e.code === "Space") this.actions.add("start");
        if (e.code === "Escape" || e.code === "KeyP") this.actions.add("pause");
        if (e.code === "KeyR") this.actions.add("restart");
        if (e.code === "KeyM") this.actions.add("mute");
      }
      this.keys.add(e.code);
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => {
      this.keys.clear();
      this.touches.clear();
      this.actions.add("blur");
    });
    addEventListener("pointerdown", (e) => {
      // Menu buttons carry their own action; a tap anywhere else means "start".
      const target = (e.target as Element | null)?.closest?.("[data-action]");
      this.actions.add((target?.getAttribute("data-action") as Action | null) ?? "start");
      if (e.pointerType === "touch") this.touches.set(e.pointerId, e.clientX);
    });
    addEventListener("pointermove", (e) => {
      if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, e.clientX);
    });
    const release = (e: PointerEvent) => this.touches.delete(e.pointerId);
    addEventListener("pointerup", release);
    addEventListener("pointercancel", release);
  }

  get steer(): number {
    let s = 0;
    if (LEFT.some((k) => this.keys.has(k))) s -= 1;
    if (RIGHT.some((k) => this.keys.has(k))) s += 1;
    if (s === 0 && this.touches.size === 1) {
      const [x] = this.touches.values();
      s = x < innerWidth / 2 ? -1 : 1;
    }
    return s;
  }

  get boost(): boolean {
    return BOOST.some((k) => this.keys.has(k)) || this.touches.size >= 2;
  }

  /** True once per press of an edge-triggered action. */
  take(action: Action): boolean {
    return this.actions.delete(action);
  }

  endFrame(): void {
    this.actions.clear();
  }
}
