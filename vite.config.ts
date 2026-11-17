import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
// The multithread FFmpeg core needs SharedArrayBuffer, which browsers only
// expose to cross-origin isolated pages.
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};
// Exposes the direct dependencies, at their package-lock.json versions, to
// the About dialog.
const lockfile = (): Plugin => {
  const id = "virtual:dependencies";
  return {
    name: "lockfile-dependencies",
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(resolved) {
      if (resolved !== `\0${id}`) return;
      const pkg = JSON.parse(readFileSync("package.json", "utf8"));
      const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
      this.addWatchFile("package.json");
      this.addWatchFile("package-lock.json");
      const dependencies = Object.keys(pkg.dependencies)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({
          name,
          version: lock.packages[`node_modules/${name}`].version,
        }));
      return `export default ${JSON.stringify(dependencies)};`;
    },
  };
};
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), lockfile()],
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg"] },
  server: { headers: isolation },
  preview: { headers: isolation },
});
