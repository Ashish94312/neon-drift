// Gameplay tunables. Distances in metres, times in seconds, speeds in m/s.

export const TRACK = {
  halfWidth: 6,
  laneWidth: 3,
  lanes: [-4.5, -1.5, 1.5, 4.5],
  near: 30, // track drawn behind the craft (camera sits here)
  far: 380, // track drawn / spawned ahead
};

export const CRAFT = {
  hover: 0.55,
  accel: 95,
  dampSteer: 6, // terminal lateral speed = accel / dampSteer ≈ 16 m/s
  dampCoast: 11,
  hitHalfWidth: 0.85,
  hitHalfLength: 1.3,
  railBounce: 0.35,
  railScrape: 0.06,
};

export const MAX_LATERAL = CRAFT.accel / CRAFT.dampSteer;

export const BARRIER = { hitHalfWidth: 1.35, hitHalfLength: 0.9, nearMissMargin: 1.0 };

export const CELL = { pickupRadius: 1.7, height: 0.45 };

export const SPEED = {
  base: 26,
  ramp: 34,
  rampDistance: 2500,
  boost: 1.45,
  hitPenalty: 0.35,
  recover: 0.4,
  title: 22,
};

export const HULL = { max: 3, invuln: 1.2 };

export const BOOST = { perCell: 0.25, drain: 0.4 };

export const SCORE = { boostMultiplier: 2, cell: 50, nearMiss: 100 };

// Curved-world bend strength (view-space offset = k · z²) and the sideways push it causes.
export const CURVE = { min: 0.00012, max: 0.00045, rise: 0.00016, push: 7 };

// Laser fence: beams across the track with one gap to steer through.
export const LASER = { hitHalfLength: 0.15, heights: [0.6, 1.25], gapStart: 5, gapEnd: 3.8, closeMargin: 0.5 };

// Checkpoint gate every km: bonus points, boost, and one hull point back.
export const CHECKPOINT = { every: 1000, bonus: 500, boost: 0.25, clear: 25 };
