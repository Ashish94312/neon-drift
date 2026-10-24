# Neon Drift — Build Plan

A futuristic hovercraft endless runner. Dodge obstacles, collect boosts, and survive as the track gets faster and denser the farther you go.

## 1. Core loop

1. The hovercraft auto-accelerates down an endless neon track; the player steers left/right.
2. Hazard barriers block lanes; hitting one costs hull and speed.
3. Boost cells fill the boost meter; burning boost gives speed and a score multiplier.
4. Difficulty ramps continuously with distance (speed, barrier density, moving barriers, curves).
5. Lose all hull and the run ends. Best score and distance are saved; retry is instant.

## 2. Asset inventory

All three models are AI-generated (trimesh export), unit-normalized, one mesh + one 1024² base-color texture each.

| File | Role | Raw size (X×Y×Z) | Tris | Notes |
|---|---|---|---|---|
| `assets/vehicle_hovercraft_player.glb` | Player craft | 0.72 × 0.29 × 1.00 | 9.8k | Nose faces +Z, twin thrusters at −Z. Black hull, cyan neon strips. |
| `assets/obstacle_hazard_barrier.glb` | Obstacle | 1.00 × 0.51 × 0.60 | 12.9k | Black block, yellow hazard stripes, red lights. |
| `assets/pickup_boost_cell.glb` | Boost pickup | 1.00 × 1.00 × 1.00 | 21.3k | Cyan crystal energy cell. Too dense for many instances. |

Renamed from `output.glb`, `output (1).glb`, `output (2).glb`. Naming rule for new assets: `<category>_<name>.glb`, lowercase snake_case (categories: `vehicle`, `obstacle`, `pickup`, `env`, `fx`). Internal scene/node/mesh/material names were also set (e.g. `hovercraft_player`, `hovercraft_player_mesh`, `hovercraft_player_mat`).

`assets/` holds the source files. `npm run assets` writes optimized copies to `src/models/`, which the game imports.

### Fixes the assets need

- **No normals.** Loaders fall back to flat shading. Compute creased normals at load (`toCreasedNormals`, which welds by position, so UV seams don't show).
- **No emissive map.** The neon strips are baked into base color on a near-black body. At load, build an emissive mask from saturated, bright texels (threshold tuned per asset so hazard stripes stay matte and lights glow). Pair with bloom.
- **Scale and orientation.** Bake into geometry at load. Hovercraft ×3 (≈3 m long) and rotated so the nose faces −Z (forward). Barrier ×3 (≈3 m wide, 1.5 m tall). Boost cell ≈1 m.
- **Pickup density.** Simplify the boost cell, and render all pickups and barriers with `InstancedMesh`.
- **File size.** About 1.3–1.9 MB each, mostly PNG. The game ships inlined in one HTML file (see §4), so textures are converted to WebP and meshes are welded/simplified by `@gltf-transform/cli`.

## 3. Tech stack

- **Three.js + TypeScript + Vite.** GLB assets load natively and it runs in any browser.
- **No physics engine.** Movement and collision run in *track space* (distance along track `s`, lateral offset `x`). The player stays at the origin and the world scrolls toward it, so there is no float drift on long runs.
- **Curves:** a "curved world" vertex-shader bend applied to every material. The track reads as curving and rising without any spline math, and collision stays 2D.
- **Postprocessing:** `EffectComposer` + `UnrealBloomPass` for the neon look.
- **Build:** `vite-plugin-singlefile` emits one self-contained `dist/index.html` with JS and models inlined.
- **Hosting:** Streamlit (see §4).
- **Audio:** Web Audio API (later milestone).

## 4. Hosting on Streamlit

Streamlit runs Python. Its static file serving sends `.js` as `text/plain`, which browsers refuse to execute, so the game can't be served as normal static files. Instead:

1. `npm run build` → `dist/index.html`. This is a single file with everything inlined (≈1.3 MB, 630 KB gzipped, including the Saira font).
2. `app.py` passes that file to `st.iframe(Path(...), height=720)`, which embeds it via `srcdoc` in a full-width iframe. `streamlit.components.v1.html` was deprecated in June 2026, so the app requires `streamlit>=1.66`.
3. Deploy to Streamlit Community Cloud from a GitHub repo containing `app.py`, `requirements.txt` and the built `dist/index.html`. Cloud does not run `npm`, so **commit `dist/` after every build**.

Run locally: `pip install -r requirements.txt && streamlit run app.py`. For development use `npm run dev` (Vite, hot reload) instead.

Constraints this puts on the game:

- **Fixed iframe height.** The game fills the iframe and handles resize. The aspect ratio follows Streamlit's container width.
- **Keyboard focus.** The iframe needs a click before it gets key events, so the title screen says "click to start".
- **No fullscreen.** The Streamlit iframe doesn't grant fullscreen, so don't rely on it.
- **localStorage.** Only for best scores, wrapped in try/catch so the game works when storage is blocked.

## 5. Project structure

```
Vi3W/
  app.py                      # Streamlit wrapper
  requirements.txt
  assets/                     # source GLBs
  tools/optimize-assets.mjs   # assets/ -> src/models/
  dist/index.html             # built game (committed for Streamlit Cloud)
  src/
    main.ts
    models/                   # optimized GLBs (generated)
    core/       Game.ts  Input.ts  Assets.ts  Config.ts  Rng.ts
    world/      Track.ts  Spawner.ts  Environment.ts  CurvedWorld.ts
    entities/   Hovercraft.ts
    systems/    Difficulty.ts  Save.ts
    fx/         PostFX.ts  Trail.ts  CameraRig.ts
    ui/         Hud.ts
```

## 6. Gameplay spec (starting values, tune in playtests)

**Track.** 12 m wide, 4 lanes (x = −4.5, −1.5, 1.5, 4.5), glowing edge rails, a scrolling grid shader, and a light pool under the craft. Curves come from the vertex bend, and the bend amount drifts over time.

**Controls.** A/D or ←/→ to steer, Shift or Space to boost, Esc/P to pause, Enter or click to start/retry. Touch: hold the left/right half of the screen to steer.

**Hover feel.**
- Lateral motion uses acceleration and damping, so it drifts instead of snapping.
- Roll and yaw follow lateral velocity, plus a pitch-up while boosting.
- The craft bobs gently. Edge rails bounce the craft back and scrape speed.

**Speed.** `26 + 34·r` m/s, where `r = 1 − e^(−distance/2500)`. That's 26 m/s at the start, ≈47 at 2.5 km, and it approaches 60. Boost multiplies speed by 1.45. A hit cuts 35% speed, which recovers.

**Hull and boost.**
- 3 hull points. A hit costs 1 and gives 1.2 s of invulnerability (flashing).
- A boost cell adds 25% to the meter. Boost drains 40%/s.

**Score.** Distance (1 pt/m) × multiplier (×2 while boosting), plus 50 per cell and 100 per near miss.

**Collision.** 2D boxes in `(s, x)`, slightly forgiving. Only entities near the craft are checked.

**Difficulty ramp** (all driven by `r`):

| Param | Start (r≈0) | ~2.5 km (r≈0.63) | Late (r→1) |
|---|---|---|---|
| Speed | 26 m/s | 47 m/s | 60 m/s |
| Time between barrier rows | 2.0 s (≈52 m) | 1.27 s (≈60 m) | 0.85 s (≈51 m) |
| Barriers per row (of 4 lanes) | 1 | 2 | 3 |
| Moving-barrier chance | 0% | 25% | 45% |
| Boost cell spacing | 30 m | 46 m | 55 m |
| Curve strength | gentle | medium | strong |

**Laser fence** (from ≈300 m; 12% → 30% of rows). Red-orange beams at two heights span the track except for one gap, with posts at the rails and a glowing line on the road. The gap is centred on the safe lane and narrows from 5 m to 3.8 m. Later in the run, half the fences have a gap that slides between the safe lane and a neighbour. Touching a beam costs 1 hull, like a barrier. Threading a gap with under 0.5 m to spare counts as a close call.

**Checkpoint gate** (every 1 km). A neon arch with a lit distance sign and a scanline curtain. Passing through gives +500 points and +25% boost, and repairs 1 hull point if you're damaged. The road is kept clear for 25 m either side of the gate.

**Audio** (all synthesized with Web Audio, no files):
- **Engine:** pitch and filter follow speed and boost.
- **Air rush:** noise that opens up with speed.
- **Effects:** boost whoosh, pickup chime, close-call swoosh panned to the obstacle's side, impact, laser zap, wreck, rail scrape, checkpoint chime.
- **Music:** a synthwave loop in Am–F–C–G at 104 bpm. Title: pad and bass. Race: adds arpeggio and drums. Pause: muffled. Game over: pad only.
- **Mute:** M key or the Sound button; the setting is remembered.

**Fairness rule.** Each barrier row keeps a *safe lane*. That lane shifts at most as many lanes as the craft can cross before the next row arrives at current speed. This guarantees every run is passable. Seeds come from a seeded RNG, so a bad layout can be reproduced.

## 7. Milestones

Each milestone ends with something playable.

| # | Milestone | Deliverables | Done when | Status |
|---|---|---|---|---|
| M0 | Setup + pipeline + hosting | Vite/TS/Three scaffold, `optimize-assets`, loader with normals/emissive fixes, single-file build, `app.py` | Built HTML runs inside `streamlit run app.py` | Done |
| M1 | Hover movement | Craft at origin, steering, drift, roll, bob, chase camera, curved-world bend | Steering feels responsive at 60 fps | Done, needs a real-GPU feel pass |
| M2 | Endless track | Scrolling grid track, edge rails, city skyline that recycles, fog, bloom | Feels like infinite forward motion | Done |
| M3 | Obstacles | Instanced barriers, spawner with safe-lane rule, collision, hull, hit feedback | Can crash and lose a run | Done |
| M4 | Boosts + ramp | Instanced boost cells, boost meter/burn, distance-driven difficulty, moving barriers | Run gets noticeably harder each km | Done (a greedy test bot survives ≈4–7 km) |
| M5 | Game flow + UI | Title, HUD (score, distance, speed, hull, boost), pause, game over, best in `localStorage` | Menu → run → retry without reload | Done |
| M6 | Juice + variety | Thruster trail, camera shake/FOV kick, km banner, audio, laser fences, checkpoint gates, pickup burst | Game "feels" neon | Done except pickup burst |
| M7 | Polish + ship | Perf pass, touch boost button, quality setting (bloom off), deploy to Streamlit Cloud | 60 fps on a mid laptop, live URL | Not started |

## 8. UI direction

The UI reads like the craft's onboard instruments. It is left-aligned like a race broadcast, and the 3D scene stays visible.

- **Type:** Saira variable, one family. Its width axis is the signature: the speed digits widen from 100% to 125% as speed rises.
- **Colour:** night `#07020F`, chalk `#F1EDFF`, haze `#A498CF`, signal `#00E5FF` (speed/boost), overdrive `#FF2BD6` (boosting), hazard `#FFC23D` (close calls, matching the barrier stripes), damage `#FF3B5C` (hull).
- **Layout:** score top-left, instrument cluster bottom-right (hull pips, speed, segmented boost gauge), menus as a bottom-left panel over a left-side dark gradient. A dashed "lane line" under each heading repeats the track dividers.
- **Copy:** sentence case, plain verbs ("Race", "Race again", "Resume", "Restart"). Hints are contextual: "Hold Shift to boost" shows until the player first boosts. Touch devices get touch wording.
- **Accessibility:** real buttons with visible keyboard focus. `prefers-reduced-motion` swaps sliding text for fades and cuts camera shake to 30%.

## 9. Assets still missing

- **Environment:** procedural (gradient sky, neon sun, instanced skyline, fog). No models needed.
- **More obstacles (optional):** laser fences and checkpoint gates are done (procedural). Next candidates: sliding pylons, and a shield pickup.
- **UI:** done. Saira variable (OFL) is bundled from `@fontsource-variable/saira` and inlined, so no network font is needed.

## 10. Risks

- **AI-mesh shading:** creased normals may still show artifacts. Fall back to a Blender bake.
- **Bloom cost on low-end devices:** add a quality toggle.
- **Inline size:** the built HTML is sent through Streamlit's websocket on each rerun. Keep it under about 3 MB (WebP textures, simplified meshes).
- **Streamlit API drift:** `components.v1.html` is already deprecated; the app uses `st.iframe`. Re-check it when upgrading Streamlit.
