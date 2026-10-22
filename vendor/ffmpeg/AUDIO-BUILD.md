# Audio-only FFmpeg core

This directory contains the single-thread JS/WASM core and its build configuration.
The build uses FFmpeg 5.1.4 and Emscripten 3.1.61 on Linux ARM64, producing
WebAssembly for supported browsers on any host architecture.

## Rebuild

Requires Git, Docker with Buildx, and a running Docker-compatible engine.
Run the following from the Audio Lab repository root to create a fresh build checkout:

```bash
git clone https://github.com/ffmpegwasm/ffmpeg.wasm.git artifacts/ffmpeg-audio
git -C artifacts/ffmpeg-audio checkout f876f907c7e9b9bf51d4ed0b913a855a63ae63fc
git -C artifacts/ffmpeg-audio apply ../../vendor/ffmpeg/build-scripts.patch
cp vendor/ffmpeg/Dockerfile.audio-arm64 artifacts/ffmpeg-audio/
cp vendor/ffmpeg/audio-core-flags.sh artifacts/ffmpeg-audio/build/
cd artifacts/ffmpeg-audio

docker buildx build \
  --platform linux/arm64 \
  --file Dockerfile.audio-arm64 \
  --build-arg FFMPEG_ST=yes \
  --build-arg 'EXTRA_CFLAGS=-O3 -msimd128' \
  --build-arg 'EXTRA_LDFLAGS=-O3 -msimd128' \
  --output type=local,dest=packages/audio-core \
  --progress plain .
```

The output files are `packages/audio-core/dist/esm/ffmpeg-core.js` and
`packages/audio-core/dist/esm/ffmpeg-core.wasm` in the build checkout.

## Update the bundled core

Replace both files in `vendor/ffmpeg/` together and update their SHA-256 hashes
in `manifest.json`. Keep the build configuration and source references aligned
with the replacement binaries. From the Audio Lab repository root, run:

```bash
npm run sync:engine
npm test
npm run build
npm run test:browser
```

The sync script checks the hashes before copying either file to `public/ffmpeg/`.
Development and production builds run that script automatically.

## Source versions

| Component | Commit |
| --- | --- |
| ffmpeg.wasm | f876f907c7e9b9bf51d4ed0b913a855a63ae63fc |
| FFmpeg 5.1.4 | 4729204c17f756e186d622060088371d10b34f7e |
| LAME | 2badea1974ae36cb8312afe99cff1e6b3b5decee |
| Ogg 1.3.4 | bada45718453ac27b56773ae663f7e65112f6a6e |
| Vorbis 1.3.3 | 7798164043197d7e33f02de4353ce2aa5b248225 |
| Opus 1.3.1 | e85ed7726db5d677c9c0677298ea0cb9c65bdd23 |
| zlib 1.2.11 | cacf7f1d4e3d44d871b605da3b647f07d718623f |

The compiler image digest and binary hashes are recorded in `manifest.json`.
