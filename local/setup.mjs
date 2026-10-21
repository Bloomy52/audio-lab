import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const source = resolve(dirname(require.resolve("@ffmpeg/core")), "../esm");
const target = new URL("./app/ffmpeg/", import.meta.url);
await mkdir(target, { recursive: true });
for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  await copyFile(resolve(source, file), new URL(file, target));
}
console.log("Audio engine installed. Run npm start to open Audio Lab.");
