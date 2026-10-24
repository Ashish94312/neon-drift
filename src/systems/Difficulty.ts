import { CURVE, LASER, SPEED } from "../core/Config";

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0 at the start of a run, approaching 1 as distance grows. Drives every difficulty knob. */
export const rampAt = (distance: number) => 1 - Math.exp(-Math.max(0, distance) / SPEED.rampDistance);

export const baseSpeed = (distance: number) => SPEED.base + SPEED.ramp * rampAt(distance);

/** Seconds between barrier rows. */
export const rowInterval = (ramp: number) => lerp(2.0, 0.85, ramp);

export const movingChance = (ramp: number) => (ramp < 0.2 ? 0 : lerp(0, 0.45, (ramp - 0.2) / 0.8));

export const cellChance = (ramp: number) => lerp(0.75, 0.4, ramp);

export const curveAmount = (ramp: number) => lerp(CURVE.min, CURVE.max, ramp);

export const laserChance = (ramp: number) => (ramp < 0.12 ? 0 : lerp(0.12, 0.3, ramp));

export const laserGap = (ramp: number) => lerp(LASER.gapStart, LASER.gapEnd, ramp);
