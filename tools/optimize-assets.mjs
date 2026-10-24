// Optimizes source GLBs in assets/ into src/models/ for inlining into the single-file build.
// Usage: npm run assets            (meshopt-compressed, what the game loads)
//        npm run assets -- --raw   (no geometry compression, for inspecting output)
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const bin = join(root, "node_modules/.bin/gltf-transform");
const raw = process.argv.includes("--raw");
const outDir = join(root, raw ? "tools/preview" : "src/models");

// ratio: fraction of vertices to keep; size: max texture dimension
const ASSETS = [
  { name: "vehicle_hovercraft_player", ratio: 0.6, size: 1024 },
  { name: "obstacle_hazard_barrier", ratio: 0.4, size: 1024 },
  { name: "pickup_boost_cell", ratio: 0.2, size: 512 },
];

mkdirSync(outDir, { recursive: true });

for (const { name, ratio, size } of ASSETS) {
  const src = join(root, "assets", `${name}.glb`);
  const dst = join(outDir, `${name}.glb`);
  execFileSync(bin, [
    "optimize", src, dst,
    "--compress", raw ? "false" : "meshopt",
    "--texture-compress", "webp",
    "--texture-size", String(size),
    "--simplify-ratio", String(ratio),
    "--simplify-error", "0.002",
    "--palette", "false",
  ], { stdio: "inherit" });
  const kb = (p) => (statSync(p).size / 1024).toFixed(0);
  console.log(`${name}: ${kb(src)} KB -> ${kb(dst)} KB`);
}
