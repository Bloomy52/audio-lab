# Bundled FFmpeg WebAssembly core

Package: @ffmpeg/core 0.12.10 (single-thread build), pinned in package-lock.json.

Upstream package metadata identifies the core's license as GPL-2.0-or-later. FFmpeg and the enabled codec libraries have their own upstream notices and license terms. The wrapper @ffmpeg/ffmpeg is a separate package.

- Core package and exact release artifact: https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10
- Exact package archive: https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz
- Source repository and build instructions: https://github.com/ffmpegwasm/ffmpeg.wasm
- FFmpeg source: https://github.com/FFmpeg/FFmpeg
- FFmpeg licensing information: https://ffmpeg.org/legal.html

The bundled JS/WASM files are copied without modification from this exact npm package by scripts/sync-engine.mjs. They are served from the same origin as Audio Lab. Keep this notice with distributions and review the upstream distribution/source requirements before publishing a modified engine.
