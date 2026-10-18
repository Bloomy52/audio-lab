# Audio Lab

A local browser audio converter and loop editor. Files are processed in Web Audio and a bundled, pinned FFmpeg WebAssembly engine; audio is never uploaded. The engine is served from this site, with no third-party CDN dependency. A browser still needs to load the site/assets; this is not an installable offline application.

## Run and verify

Use Node.js 24 or newer (the tests use native TypeScript type stripping).

```sh
npm ci
npm run dev
```

```sh
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

`npm test` runs deterministic audio/metadata/player tests and real conversions through the same FFmpeg WASM binary shipped to the browser. `test:browser` runs against the production build. It covers upload, source-rate decoding, marker edits, exports/downloads, ZIP uniqueness, workspace switching, cancellation, touch editing, and help-dialog behavior.

Private fixture tests are optional: create `tests/fixtures.local.json` using the shape below, then run `npm run test:fixtures`. These tests require native `ffmpeg` and `ffprobe` on PATH to independently compare decoded PCM and inspect outputs. The browser suite also uses this manifest when it exists. Local paths, test outputs, and audio assets are ignored by Git; fixtures are never copied into `public/` or deployment output.

```json
[
  {
    "name": "trusted-loop",
    "path": "/absolute/path/audio.wav",
    "rate": 48000,
    "loopStart": 313344,
    "loopEnd": 1779528
  },
  { "name": "unlooped", "path": "/absolute/path/audio.flac", "rate": 44100 }
]
```

All manifest/UI end frames are **exclusive**. WAV `smpl` stores an inclusive end, so the parser adds one and the writer subtracts one. AIFF marker positions are preserved as authored. The supplied user fixtures were checked independently before setting their expected values.

## Editing and output behavior

- Studio preserves the source sample rate during native decoding, with an FFmpeg PCM fallback for formats the browser cannot decode. Audio tracks in multi-stream files can be selected. Editing supports mono/stereo; multichannel inputs must be downmixed in Batch first.
- Whole-track export keeps the intro/tail and writes the selected loop markers. Loop-region export crops the selection and can repeat it 1/2/4/8 times.
- Crossfade defaults to **off**, so trusted markers and loop timing are not changed automatically. Optional linear overlap crossfade is bounded to half the selection and shortens each repetition by the displayed overlap. Audition the prepared loop before exporting. It does not promise to eliminate every possible click.
- Zero-crossing snap is optional, stays within valid bounds, and reports when no crossing was found. A channel-1 crossing does not guarantee matching stereo phase.
- Compressor and loudness normalization are **export-only**. They retain the selected output sample rate and include a final peak limiter. Listen to the rendered output to hear their effect. Single-pass loudness normalization targets −16 LUFS; source duration/content can prevent an exact integrated loudness result.
- Region processing uses a worker and floating-point intermediates. Explicit 16/24/32-bit integer PCM output is available for WAV/AIFF. FLAC/ALAC use 16 or 24 bits. No “bit-perfect” claim is made for processing, resampling, downmixing, or bit-depth reduction. Whole-track unprocessed 16-bit lossless conversions were independently checked for identical PCM.
- Supported outputs: WAV, AIFF, FLAC, ALAC/M4A, MP3, Ogg Vorbis, Opus, AAC/M4A, AAC/ADTS, WebM Audio, WMA, AC3, and signed 16-bit little-endian raw PCM. AMR is not available in the engine build. Raw output requires recording the displayed sample rate/channels for re-import.
- Only verified mode/rate combinations are offered. An incompatible source rate is explicitly resampled with a result notice. Opus/WebM use explicit 10 ms frames because default 20 ms stereo encoding crashes the pinned engine in regression tests. All outputs explicitly exclude image/video, subtitle, and data streams, including album artwork.
- Loop metadata is supported for WAV `smpl`, AIFF MARK/INST, FLAC comments, Vorbis comments, and Opus comments. Coordinates are scaled after resampling. Unsupported loop types or malformed metadata are reported; multiple/release/reverse/ping-pong/finite loops are not faithfully preserved. Non-loop descriptive metadata and artwork are not copied to outputs.
- Size mode uses actual probed duration and **decimal MB**, validates final file bytes, and retries within bounds. An impossible budget fails clearly instead of silently returning an oversized file. Codec bitrate constraints may require choosing another format or larger budget.

## Resource and session limits

128 MiB input per file; 192 MiB queued batch input and retained outputs; at most 50 batch entries. Studio checks a 192 MiB working-PCM allocation budget, including repeat preparation. These conservative limits reduce browser crashes but do not guarantee enough memory on every device. ZIP generation is limited by the retained output budget and cannot be cancelled once JSZip starts; errors and progress are shown.

Workspaces remain mounted when switching tabs; background jobs are serialized and can be cancelled. A hidden studio pauses audio playback. Refreshing/closing the page clears the session, so download results first. The app does not persist private audio in browser storage. Completed batch files retain their applied settings and unique filenames; remove/re-add sources to reconvert them.

Source preview and rendered output have separate players. Browser playback support depends on the output codec; a valid download may be unsupported by the browser audio element.

## GitHub Pages

The included `.github/workflows/pages.yml` runs lint, unit/engine tests, the build, and Chromium tests. On a push to `main`, a successful build uploads `dist` and deploys it with GitHub Pages. Set repository **Settings → Pages → Source → GitHub Actions**. PRs run checks without deployment. Private audio fixtures are neither required in CI nor deployed.

Vite uses relative asset paths. `predev`/`prebuild` copy the pinned `@ffmpeg/core@0.12.10` engine into `public/ffmpeg`; `dist` includes it. The app uses the single-thread core and does not require COOP/COEP or a service-worker reload. See `public/ffmpeg/NOTICE.md` for upstream package/source references.

`AUDIO_LAB_REVIEW.md` is the historical pre-fix audit; `FIX_VERIFICATION.md` records the implementation and verification status.
