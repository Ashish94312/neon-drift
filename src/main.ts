import { Game } from "./core/Game";

const game = new Game(document.getElementById("app")!);
game.init();
// `?debug` exposes the game instance for headless playtests.
if (new URLSearchParams(location.search).has("debug")) Object.assign(window, { neonDrift: game });
