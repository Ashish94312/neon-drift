import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Single self-contained index.html (JS + models inlined) so Streamlit can embed it.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { chunkSizeWarningLimit: 4096 },
});
