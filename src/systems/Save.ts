// Best run, kept in localStorage. Storage can be blocked (private mode, sandboxed iframe), so every access is guarded.
const KEY = "neon-drift.best";

export interface Best {
  score: number;
  distance: number;
}

export function loadBest(): Best {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const b = JSON.parse(raw);
      if (typeof b?.score === "number" && typeof b?.distance === "number") return b;
    }
  } catch {
    // ignore: play without saved bests
  }
  return { score: 0, distance: 0 };
}

export function saveBest(best: Best): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(best));
  } catch {
    // ignore
  }
}

export function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function saveFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // ignore
  }
}
