import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// The multithread FFmpeg core needs SharedArrayBuffer, which browsers only
// expose to cross-origin isolated pages.
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg"] },
  server: { headers: isolation },
  preview: { headers: isolation },
});
