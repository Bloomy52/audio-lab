import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { FFmpegService } from "../src/services/ffmpegService.ts";
import {
  defaultOptions,
  FORMATS,
  modesFor,
} from "../src/utils/exportOptions.ts";
import {
  readAudioMetadata,
  injectLoopChunks,
  loopFromFrames,
} from "../src/utils/audioMetadata.ts";
import { CoreAdapter } from "./coreAdapter.mjs";
import { sine } from "./helpers.mjs";
let adapter;
let service;
before(() => {
  service = new FFmpegService(
    async () => {
      adapter = new CoreAdapter();
      return adapter;
    },
    () => ({}),
  );
});
test("engine probe returns accurate PCM rate, frames, duration", async () => {
  const info = await service.inspectAudio(sine(1.2345, 44100), "wav");
  assert.equal(info.sampleRate, 44100);
  assert.equal(info.frames, Math.round(1.2345 * 44100));
  assert.equal(info.channels, 2);
});
test("every advertised output format encodes using the shipped engine", async () => {
  for (const { value: format } of FORMATS) {
    const options = {
      ...defaultOptions(),
      format,
      compressionMode: modesFor(format)[0],
    };
    const out = await service.transcodeAudio(sine(), "wav", options);
    assert.ok(out.blob.size > 0, format);
  }
});
test("normalization retains explicit source rate and valid loops", async () => {
  const out = await service.transcodeAudio(
    sine(4),
    "wav",
    { ...defaultOptions(), normalizeLufs: true },
    undefined,
    undefined,
    { loopStartSample: 4800, loopEndSample: 180000 },
  );
  const meta = readAudioMetadata(new Uint8Array(await out.blob.arrayBuffer()));
  assert.equal(meta.sampleRate, 48000);
  assert.equal(meta.frames, 192000);
  assert.equal(meta.loop.loopStartSample, 4800);
  assert.equal(meta.loop.loopEndSample, 180000);
});
test("resampling scales loop coordinates and batch preserves WAV smpl", async () => {
  const input = injectLoopChunks(
    sine(),
    "wav",
    loopFromFrames(4800, 48000, 48000),
    48000,
  );
  const out = await service.transcodeAudio(input, "wav", {
    ...defaultOptions(),
    sampleRate: 24000,
  });
  const meta = readAudioMetadata(new Uint8Array(await out.blob.arrayBuffer()));
  assert.equal(meta.loop.loopStartSample, 2400);
  assert.equal(meta.loop.loopEndSample, 24000);
});
test("loop metadata round-trips through AIFF, FLAC, Ogg and Opus", async () => {
  for (const format of ["aiff", "flac", "ogg", "opus"]) {
    const out = await service.transcodeAudio(
      sine(2),
      "wav",
      { ...defaultOptions(), format, compressionMode: modesFor(format)[0] },
      undefined,
      undefined,
      { loopStartSample: 4800, loopEndSample: 48000 },
    );
    const meta = readAudioMetadata(
      new Uint8Array(await out.blob.arrayBuffer()),
    );
    assert.deepEqual(meta.warnings, [], format);
    assert.equal(meta.loop.loopStartSample, 4800, format);
    assert.equal(meta.loop.loopEndSample, 48000, format);
  }
});
test("progress belongs only to the current job and listeners are removed", async () => {
  let first = 0,
    second = 0;
  await service.transcodeAudio(
    sine(),
    "wav",
    defaultOptions(),
    undefined,
    () => first++,
  );
  const count = first;
  await service.transcodeAudio(
    sine(),
    "wav",
    defaultOptions(),
    undefined,
    () => second++,
  );
  assert.equal(first, count);
  assert.ok(second >= 3);
  assert.equal(adapter.listeners.progress.size, 0);
  assert.equal(adapter.listeners.log.size, 0);
});
test("target-size output is checked against actual decimal bytes", async () => {
  const out = await service.transcodeAudio(sine(15, 16000), "wav", {
    ...defaultOptions(),
    format: "mp3",
    compressionMode: "target_size",
    targetSizeMb: 0.05,
  });
  assert.ok(out.blob.size <= 50000);
  await assert.rejects(
    service.transcodeAudio(sine(), "wav", {
      ...defaultOptions(),
      format: "mp3",
      compressionMode: "target_size",
      targetSizeMb: 0.0001,
    }),
    /too small/,
  );
});
test("audio extraction excludes picture/video streams", async () => {
  const video = new Uint8Array(fs.readFileSync(
    new URL("./fixtures/video-with-audio.mp4", import.meta.url),
  ));
  await assert.rejects(
      service.transcodeAudio(video.slice(), "mp4", defaultOptions()),
      /video file/,
  );
});
test("bad file failure is actionable and a new engine can recover", async () => {
  await assert.rejects(
    service.inspectAudio(new Uint8Array([1, 2, 3]), "wav"),
    /Encoding failed/,
  );
  const result = await service.transcodeAudio(sine(), "wav", defaultOptions());
  assert.ok(result.blob.size > 0);
});
test("pre-cancelled jobs do not run", async () => {
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    service.inspectAudio(sine(), "wav", 0, abort.signal),
    (e) => e.name === "AbortError",
  );
});
test("checked-in custom core matches the installed public assets", () => {
  for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
    assert.deepEqual(
      fs.readFileSync(new URL(`../public/ffmpeg/${file}`, import.meta.url)),
      fs.readFileSync(new URL(`../vendor/ffmpeg/${file}`, import.meta.url)),
    );
  }
  const wasm = fs.readFileSync(new URL("../public/ffmpeg/ffmpeg-core.wasm", import.meta.url));
  assert.deepEqual([...wasm.subarray(0, 4)], [0, 97, 115, 109]);
});

test("all offered sample rates encode with their default codec settings", async () => {
  const { ratesFor } = await import("../src/utils/exportOptions.ts");
  for (const { value: format } of FORMATS)
    for (const sampleRate of ratesFor(format)) {
      const out = await service.transcodeAudio(sine(), "wav", {
        ...defaultOptions(),
        format,
        compressionMode: modesFor(format)[0],
        sampleRate,
      });
      assert.ok(out.blob.size > 0, `${format}/${sampleRate}`);
    }
});
test("PCM bit depths, ADPCM variants and VBR modes encode successfully", async () => {
  for (const format of ["wav", "aiff", "flac", "alac"])
    for (const bitDepth of ["wav", "aiff"].includes(format)
      ? [16, 24, 32]
      : [16, 24]) {
      const result = await service.transcodeAudio(sine(), "wav", {
        ...defaultOptions(),
        format,
        compressionMode: modesFor(format)[0],
        bitDepth,
      });
      assert.ok(result.blob.size > 0, `${format}/${bitDepth}`);
    }
  for (const adpcmType of ["ima_wav", "ms", "yamaha"])
    assert.ok(
      (
        await service.transcodeAudio(sine(), "wav", {
          ...defaultOptions(),
          compressionMode: "adpcm",
          adpcmType,
        })
      ).blob.size > 0,
    );
  for (const format of ["mp3", "ogg", "opus", "webm"])
    assert.ok(
      (
        await service.transcodeAudio(sine(), "wav", {
          ...defaultOptions(),
          format,
          compressionMode: "lossy_vbr",
        })
      ).blob.size > 0,
    );
});

test("cancelling a queued job does not wait for or interrupt another job", async () => {
  let rejectLoad;
  let terminated = false;
  const engine = {
    load: () =>
      new Promise((_, reject) => {
        rejectLoad = reject;
      }),
    terminate: () => {
      terminated = true;
      rejectLoad?.(new Error("terminated"));
    },
    on() {},
    off() {},
  };
  const isolated = new FFmpegService(
    async () => engine,
    () => ({}),
  );
  const firstAbort = new AbortController(),
    queuedAbort = new AbortController();
  const first = isolated.inspectAudio(sine(), "wav", 0, firstAbort.signal);
  const firstRejection = assert.rejects(first, (e) => e.name === "AbortError");
  await new Promise((resolve) => setImmediate(resolve));
  const queued = isolated.inspectAudio(sine(), "wav", 0, queuedAbort.signal);
  queuedAbort.abort();
  await assert.rejects(queued, (e) => e.name === "AbortError");
  assert.equal(terminated, false, "active job must be left running");
  firstAbort.abort();
  await firstRejection;
  assert.equal(terminated, true);
});
test("compressor and output limiter preserve duration without clipping", async () => {
  const out = await service.transcodeAudio(sine(2), "wav", {
    ...defaultOptions(),
    dynamicRangeCompressor: {
      enabled: true,
      thresholdDb: 0,
      ratio: 1,
      attackMs: 5,
      releaseMs: 50,
      makeupGainDb: 12,
    },
  });
  const bytes = new Uint8Array(await out.blob.arrayBuffer());
  const meta = readAudioMetadata(bytes);
  assert.equal(meta.frames, 96000);
  let p = 12;
  const v = new DataView(bytes.buffer);
  while (p + 8 <= bytes.length) {
    const id = new TextDecoder().decode(bytes.subarray(p, p + 4));
    const n = v.getUint32(p + 4, true);
    if (id === "data") {
      for (let i = p + 8; i < p + 8 + n; i += 2)
        assert.ok(Math.abs(v.getInt16(i, true) / 32768) <= 0.981);
      break;
    }
    p += 8 + n + (n % 2);
  }
});
