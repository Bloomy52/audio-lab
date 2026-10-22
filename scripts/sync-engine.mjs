import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const source = new URL("../vendor/ffmpeg/", import.meta.url);
const target = new URL("../public/ffmpeg/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", source), "utf8"));
const files = ["ffmpeg-core.js", "ffmpeg-core.wasm"];
// Validate the matching pair before changing either public asset.
for (const file of files) {
  const hash = createHash("sha256")
    .update(readFileSync(new URL(file, source)))
    .digest("hex");
  if (hash !== manifest.files[file]) {
    throw new Error(`Custom FFmpeg checksum mismatch: ${file}`);
  }
}
mkdirSync(target, { recursive: true });
for (const file of files) copyFileSync(new URL(file, source), new URL(file, target));
console.log("Synced custom audio-only FFmpeg core from vendor/ffmpeg.");
