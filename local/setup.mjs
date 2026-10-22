import { access } from "node:fs/promises";

for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  try {
    await access(new URL(`./app/ffmpeg/${file}`, import.meta.url));
  } catch {
    throw new Error(`Bundled audio engine is missing ${file}. Extract a complete Local Edition ZIP again.`);
  }
}
console.log("Bundled custom audio engine is ready. Run npm start to open Audio Lab.");
