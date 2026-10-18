import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const entry = require.resolve("@ffmpeg/core");
const source = path.resolve(path.dirname(entry), "../esm");
mkdirSync(new URL("../public/ffmpeg/", import.meta.url), { recursive: true });
for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"])
  copyFileSync(
    path.join(source, file),
    new URL("../public/ffmpeg/" + file, import.meta.url),
  );
