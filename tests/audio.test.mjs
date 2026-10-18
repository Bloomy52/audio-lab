import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAiffLoopChunks,
  createWavSmplChunk,
  readAudioMetadata,
  injectLoopChunks,
  loopFromFrames,
  validateLoop,
} from "../src/utils/audioMetadata.ts";
import {
  createCrossfadedLoopBuffer,
  findNearestZeroCrossing,
} from "../src/utils/zeroCrossing.ts";
import { prepareAudio } from "../src/utils/prepareAudio.ts";
import {
  defaultOptions,
  modesFor,
  ratesFor,
  uniqueName,
  checkPcmBudget,
  resolvedRate,
} from "../src/utils/exportOptions.ts";
import { buffer, ctx, sine } from "./helpers.mjs";
function aiff(chunks) {
  const out = new Uint8Array(chunks.length + 12);
  out.set(new TextEncoder().encode("FORM"));
  new DataView(out.buffer).setUint32(4, out.length - 8, false);
  out.set(new TextEncoder().encode("AIFF"), 8);
  out.set(chunks, 12);
  return out;
}
test("AIFF writer has valid chunk sizes, padding and marker references", () => {
  const chunks = createAiffLoopChunks(123, 4567);
  assert.equal(chunks.length, 62);
  assert.equal(new DataView(chunks.buffer).getUint32(4, false), 26);
  const meta = readAudioMetadata(aiff(chunks), 48000);
  assert.deepEqual(meta.warnings, []);
  assert.equal(meta.loop.loopStartSample, 123);
  assert.equal(meta.loop.loopEndSample, 4567);
});
test("WAV inclusive endpoints translate to exclusive internal frames", () => {
  const chunk = createWavSmplChunk(0, 48000, 48000);
  assert.equal(new DataView(chunk.buffer).getUint32(56, true), 47999);
  const out = injectLoopChunks(
    sine(),
    "wav",
    loopFromFrames(0, 48000, 48000),
    48000,
  );
  const parsed = readAudioMetadata(out);
  assert.equal(parsed.frames, 48000);
  assert.equal(parsed.loop.loopEndSample, 48000);
  assert.equal(parsed.loop.loopLengthSamples, 48000);
});
test("metadata replacement does not duplicate smpl chunks", () => {
  const a = injectLoopChunks(
    sine(),
    "wav",
    loopFromFrames(0, 48000, 48000),
    48000,
  );
  const b = injectLoopChunks(a, "wav", loopFromFrames(100, 200, 48000), 48000);
  assert.equal(a.length, b.length);
  assert.equal(readAudioMetadata(b).loop.loopStartSample, 100);
});
test("truncated/invalid metadata is rejected with diagnostics", () => {
  const data = aiff(createAiffLoopChunks(10, 20));
  new DataView(data.buffer).setUint32(16, 999999, false);
  const result = readAudioMetadata(data, 48000);
  assert.equal(result.loop, undefined);
  assert.match(result.warnings[0], /Truncated/);
  assert.throws(() => validateLoop(loopFromFrames(5, 100, 48000), 99));
});
test("sample coordinates retain their source rate", () => {
  const data = injectLoopChunks(
    sine(1, 44100),
    "wav",
    loopFromFrames(4410, 22050, 44100),
    44100,
  );
  const meta = readAudioMetadata(data, 48000);
  assert.equal(meta.sampleRate, 44100);
  assert.equal(meta.loop.loopStartTimeSec, 0.1);
  assert.equal(meta.loop.loopEndTimeSec, 0.5);
});
test("crossfade has no correlated-signal overshoot and reports true length", () => {
  const source = buffer([Array(4800).fill(1)]);
  const out = createCrossfadedLoopBuffer(ctx, source, 0, 4800, 25);
  assert.equal(out.length, 3600);
  assert.ok(out.getChannelData(0).every((x) => x === 1));
  assert.throws(() => createCrossfadedLoopBuffer(ctx, source, 50, 20, 0));
});
test("snap search honors the opposite boundary and reports no candidate", () => {
  const source = buffer([
    Array.from({ length: 500 }, (_, i) => Math.sin(i * 0.1)),
  ]);
  const a = findNearestZeroCrossing(source, 20, 2500, "rising", 0, 39);
  const b = findNearestZeroCrossing(
    source,
    40,
    2500,
    "rising",
    a.sample + 1,
    499,
  );
  assert.ok(a.sample < b.sample);
  const none = findNearestZeroCrossing(buffer([Array(10).fill(1)]), 5);
  assert.equal(none.found, false);
});
test("worker preparation preserves floating-point headroom and exact repeats", () => {
  const out = prepareAudio(
    [new Float32Array([1.2, -1.1, 0.0000001, 0])],
    48000,
    0,
    2,
  );
  assert.equal(out.frames, 8);
  assert.equal(out.loopFrames, 4);
  assert.equal(new DataView(out.wav).getUint16(20, true), 3);
  assert.ok(new DataView(out.wav).getFloat32(44, true) > 1);
  assert.equal(
    new DataView(out.wav).getFloat32(44, true),
    new DataView(out.wav).getFloat32(60, true),
  );
});
test("memory budgets and codec modes reject invalid operations", () => {
  assert.throws(() => checkPcmBudget(48_000 * 3600, 2, 8));
  assert.deepEqual(modesFor("aiff"), ["uncompressed"]);
  assert.ok(!modesFor("raw_pcm").includes("target_size"));
  assert.ok(!ratesFor("opus").includes(44100));
  assert.equal(
    resolvedRate({ ...defaultOptions(), format: "opus" }, 44100),
    48000,
  );
});
test("archive names remain unique, including case collisions", () => {
  const used = new Set();
  assert.equal(uniqueName("song.mp3", used), "song.mp3");
  assert.equal(uniqueName("song.mp3", used), "song (2).mp3");
  assert.equal(uniqueName("SONG.mp3", used), "SONG (3).mp3");
});
