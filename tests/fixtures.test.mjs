import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { FFmpegService } from "../src/services/ffmpegService.ts";
import { CoreAdapter } from "./coreAdapter.mjs";
import { defaultOptions, modesFor } from "../src/utils/exportOptions.ts";
import { readAudioMetadata } from "../src/utils/audioMetadata.ts";
const manifest = new URL("./fixtures.local.json", import.meta.url);
const fixtures = fs.existsSync(manifest)
  ? JSON.parse(fs.readFileSync(manifest, "utf8"))
  : [];
const service = new FFmpegService(
  async () => new CoreAdapter(),
  () => ({}),
);
const dir = new URL("../artifacts/fixture-tests/", import.meta.url);
fs.mkdirSync(dir, { recursive: true });
const hash = (b) => createHash("sha256").update(b).digest("hex");
const summary = [];
for (const fixture of fixtures)
  test(`user fixture: ${fixture.name} preserves PCM and loop coordinates`, async () => {
    const source = fs.readFileSync(fixture.path);
    const sourceHash = hash(source);
    const ext = path.extname(fixture.path).slice(1);
    const meta = readAudioMetadata(source, fixture.rate);
    if (fixture.loopStart !== undefined) {
      assert.equal(meta.loop?.loopStartSample, fixture.loopStart);
      assert.equal(meta.loop?.loopEndSample, fixture.loopEnd);
    } else assert.equal(meta.loop, undefined);
    const info = await service.inspectAudio(source.slice(), ext);
    assert.equal(info.sampleRate, fixture.rate);
    assert.equal(info.channels, 2);
    const result = await service.transcodeAudio(
      source.slice(),
      ext,
      defaultOptions(),
    );
    const dest = new URL(fixture.name + ".wav", dir);
    fs.writeFileSync(dest, new Uint8Array(await result.blob.arrayBuffer()));
    const outMeta = readAudioMetadata(
      new Uint8Array(await result.blob.arrayBuffer()),
    );
    assert.equal(outMeta.sampleRate, fixture.rate);
    assert.equal(outMeta.loop?.loopStartSample, fixture.loopStart);
    assert.equal(outMeta.loop?.loopEndSample, fixture.loopEnd);
    const pcmHash = (file) =>
      execFileSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-i",
          file,
          "-map",
          "0:a:0",
          "-f",
          "hash",
          "-hash",
          "sha256",
          "-",
        ],
        { encoding: "utf8" },
      ).trim();
    assert.equal(
      pcmHash(fixture.path),
      pcmHash(dest.pathname),
      "decoded PCM must be identical for unprocessed 16-bit lossless inputs",
    );
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_streams", "-of", "json", dest.pathname],
        { encoding: "utf8" },
      ),
    );
    assert.equal(
      probe.streams.filter((s) => s.codec_type === "audio").length,
      1,
    );
    assert.equal(
      probe.streams.filter((s) => s.codec_type === "video").length,
      0,
    );
    assert.equal(
      sourceHash,
      hash(fs.readFileSync(fixture.path)),
      "source must remain unchanged",
    );
    summary.push({
      fixture: fixture.name,
      sourceSha256: sourceHash,
      sampleRate: info.sampleRate,
      frames: outMeta.frames,
      loop: outMeta.loop ?? null,
      identicalPcm: true,
    });
  });
test(
  "trusted WAV/AIFF loops survive lossless cross-format conversion and resampling",
  { skip: fixtures.length === 0 },
  async () => {
    for (const fixture of fixtures.filter((f) => f.loopStart !== undefined)) {
      const bytes = fs.readFileSync(fixture.path);
      for (const format of ["aiff", "flac", "wav"]) {
        const out = await service.transcodeAudio(
          bytes.slice(),
          path.extname(fixture.path).slice(1),
          {
            ...defaultOptions(),
            format,
            compressionMode: modesFor(format)[0],
            sampleRate: 24000,
          },
        );
        const metadata = readAudioMetadata(
          new Uint8Array(await out.blob.arrayBuffer()),
        );
        assert.deepEqual(metadata.warnings, []);
        assert.equal(metadata.sampleRate, 24000);
        assert.equal(
          metadata.loop.loopStartSample,
          Math.round(fixture.loopStart / 2),
        );
        assert.equal(
          metadata.loop.loopEndSample,
          Math.round(fixture.loopEnd / 2),
        );
      }
    }
  },
);
test(
  "write user-fixture verification summary",
  { skip: fixtures.length === 0 },
  () => {
    fs.writeFileSync(
      new URL("verification.json", dir),
      JSON.stringify(summary, null, 2) + "\n",
    );
  },
);
