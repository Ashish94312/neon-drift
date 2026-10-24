# Neon Drift

A synthwave hovercraft endless runner. Steer past barriers and laser fences, grab energy cells to boost, and pass a checkpoint every kilometre. The track keeps getting faster.

Built with Three.js and TypeScript. All audio is synthesized in the browser. It's hosted on Streamlit as one self-contained HTML file.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Steer | A / D or ← / → | Hold left / right side |
| Boost | Shift or Space | Two fingers |
| Pause | Esc | — |
| Restart (paused) | R | — |
| Sound on/off | M | Sound button |

## Run it

```bash
npm install
npm run dev            # Vite dev server with hot reload
```

To run it the way Streamlit serves it:

```bash
npm run build          # writes dist/index.html (JS, models and font inlined)
pip install -r requirements.txt
streamlit run app.py
```

## Deploy

Streamlit Community Cloud doesn't run npm, so `dist/index.html` is committed. After any change, run `npm run build` and commit `dist/` before pushing. Cloud redeploys on push.

## Assets

Source models are in `assets/`. `npm run assets` writes optimized copies (WebP textures, simplified meshes, meshopt) to `src/models/`, which the game imports.

See [PLAN.md](PLAN.md) for the design, gameplay numbers and roadmap.
