# Audio-only FFmpeg core

This directory contains the multithread JS/WASM core and its build configuration.
The build uses FFmpeg 7.1 and Emscripten 3.1.61 on Linux ARM64, producing
WebAssembly for supported browsers on any host architecture.

The FFmpeg 7.x command-line tool starts one pthread per task (demux, decode,
filter, encode, mux), so unlike the earlier 5.1.4 core this one cannot be built
single-thread. The page must be cross-origin isolated (COOP `same-origin` and
COEP `require-corp`) so the browser exposes SharedArrayBuffer. The Vite dev and
preview servers and `local/server.mjs` send those headers. Static hosts that
cannot (GitHub Pages) get them from `public/coi-sw.js`, a service worker that
`public/coi-register.js` installs, reloading the page once on first visit.

## Rebuild

Requires Git, Docker with Buildx, and a running Docker-compatible engine.
On Apple Silicon the linux/arm64 image runs natively, with no emulation.
Run the following from the Audio Lab repository root to create a fresh build checkout:

```bash
git clone https://github.com/ffmpegwasm/ffmpeg.wasm.git artifacts/ffmpeg-audio
git -C artifacts/ffmpeg-audio checkout f876f907c7e9b9bf51d4ed0b913a855a63ae63fc
git -C artifacts/ffmpeg-audio apply ../../vendor/ffmpeg/build-scripts.patch

# The command-line sources come from FFmpeg itself and are patched for wasm.
git clone --depth 1 --branch n7.1 https://github.com/FFmpeg/FFmpeg.git artifacts/ffmpeg-n7.1
rm -rf artifacts/ffmpeg-audio/src/fftools && mkdir artifacts/ffmpeg-audio/src/fftools
for f in cmdutils.c cmdutils.h ffmpeg.c ffmpeg.h ffmpeg_dec.c ffmpeg_demux.c ffmpeg_enc.c \
  ffmpeg_filter.c ffmpeg_hw.c ffmpeg_mux.c ffmpeg_mux.h ffmpeg_mux_init.c ffmpeg_opt.c \
  ffmpeg_sched.c ffmpeg_sched.h ffmpeg_utils.h ffprobe.c fopen_utf8.h objpool.c objpool.h \
  opt_common.c opt_common.h sync_queue.c sync_queue.h thread_queue.c thread_queue.h Makefile; do
  cp artifacts/ffmpeg-n7.1/fftools/$f artifacts/ffmpeg-audio/src/fftools/
done
patch -p1 -d artifacts/ffmpeg-audio/src/fftools < vendor/ffmpeg/fftools-n7.1.patch

cp vendor/ffmpeg/Dockerfile.audio-arm64 artifacts/ffmpeg-audio/
cp vendor/ffmpeg/audio-core-flags.sh artifacts/ffmpeg-audio/build/
cd artifacts/ffmpeg-audio

docker buildx build \
  --platform linux/arm64 \
  --file Dockerfile.audio-arm64 \
  --build-arg FFMPEG_MT=yes \
  --build-arg 'EXTRA_CFLAGS=-O3 -msimd128 -sUSE_PTHREADS -pthread' \
  --build-arg 'EXTRA_LDFLAGS=-O3 -msimd128 -sUSE_PTHREADS -pthread' \
  --output type=local,dest=packages/audio-core-mt \
  --progress plain .
```

The build produces two JavaScript files that share one byte-identical
`ffmpeg-core.wasm`:

- `packages/audio-core-mt/dist/esm/ffmpeg-core.js` is the browser core.
- `packages/audio-core-mt/dist/node/ffmpeg-core.js` also targets Node.js. It
  imports `node:module`, so browsers cannot load it. It is only for the test
  suite and is stored as `ffmpeg-core.node.js`.

Ignore `ffmpeg-core.worker.mjs`. Emscripten 3.1.61 starts pthread workers from
`ffmpeg-core.js` itself, so no separate worker file is shipped.

## Update the bundled core

Copy the browser `ffmpeg-core.js`, the Node `ffmpeg-core.js` (renamed
`ffmpeg-core.node.js`) and `ffmpeg-core.wasm` into `vendor/ffmpeg/`, and update
their SHA-256 hashes in `manifest.json`. Keep the build configuration and source
references aligned with the replacement binaries. From the Audio Lab repository
root, run:

```bash
npm run sync:engine
npm test
npm run build
npm run test:browser
```

The sync script checks the hashes before copying the browser core and wasm to
`public/ffmpeg/`. Development and production builds run that script automatically.

## Changes to the FFmpeg command-line sources

`fftools-n7.1.patch` ports the ffmpeg.wasm changes to the 7.1 sources:

- `ffmpeg()` and `ffprobe()` replace `main()`. 7.x returns normally instead of
  calling `exit_program`, so `bind.js` reads the return value.
- Progress is sent to JavaScript, and `-timeout` is honoured inside the
  transcode loop.
- Global state is reset between calls so one core can run many commands.
- `av_cpu_force_count(4)` caps decoder and filter-graph thread pools. The
  worker pool is created up front (`-sPTHREAD_POOL_SIZE=32`) because the calling
  thread blocks while ffmpeg runs and cannot start more. Without the cap, a
  15-core machine decoding ALAC (frame threads) deadlocks.

## Source versions

| Component | Commit |
| --- | --- |
| ffmpeg.wasm | f876f907c7e9b9bf51d4ed0b913a855a63ae63fc |
| FFmpeg 7.1 | b08d7969c550a804a59511c7b83f2dd8cc0499b8 |
| LAME | 2badea1974ae36cb8312afe99cff1e6b3b5decee |
| Ogg 1.3.4 | bada45718453ac27b56773ae663f7e65112f6a6e |
| Vorbis 1.3.3 | 7798164043197d7e33f02de4353ce2aa5b248225 |
| Opus 1.3.1 | e85ed7726db5d677c9c0677298ea0cb9c65bdd23 |
| zlib 1.2.11 | cacf7f1d4e3d44d871b605da3b647f07d718623f |

The compiler image digest and binary hashes are recorded in `manifest.json`.
