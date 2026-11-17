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
// Exposes the package-lock.json package list to the About dialog.
const lockfile = (): Plugin => {
  const id = "virtual:dependencies";
  return {
    name: "lockfile-dependencies",
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(resolved) {
      if (resolved !== `\0${id}`) return;
      const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
      this.addWatchFile("package-lock.json");
      const dependencies = Object.entries<{ version: string; dev?: boolean }>(
        lock.packages,
      )
        .filter(([path]) => path.includes("node_modules/"))
        .map(([path, { version, dev }]) => ({
          name: path.slice(path.lastIndexOf("node_modules/") + 13),
          version,
          dev: !!dev,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
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
