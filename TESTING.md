# Testing Audio Lab

### Requirements
You will need to install `Git` and `Node.js` 24 or newer (the tests use native TypeScript type stripping).

## Install

```bash
npm ci
npm run dev
```

```bash
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
