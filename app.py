"""Streamlit host for Neon Drift.

The game is one self-contained HTML file (JS + models inlined) built by `npm run build`
into dist/index.html. Streamlit Community Cloud doesn't run npm, so commit dist/ after
every build.
"""

from pathlib import Path

import streamlit as st

GAME = Path(__file__).parent / "dist" / "index.html"
GAME_HEIGHT = 720

st.set_page_config(
    page_title="Neon Drift",
    page_icon="🛸",
    layout="wide",
    initial_sidebar_state="collapsed",
)
st.html(
    """<style>
    .block-container { padding-top: 1.2rem; padding-bottom: 0.5rem; }
    header[data-testid="stHeader"] { background: transparent; }
    </style>"""
)

if not GAME.exists():
    st.error("Game build not found. Run `npm run build` and commit `dist/index.html`.")
    st.stop()

# Path input: Streamlit reads the file and embeds it via srcdoc, so no static serving is needed.
st.iframe(GAME, height=GAME_HEIGHT, alt="Neon Drift: hovercraft endless runner")
st.caption(
    "Click the game to focus it · A/D or ←/→ steer · Shift/Space boost · Esc pause · "
    "touch: hold left/right to steer, two fingers to boost"
)
