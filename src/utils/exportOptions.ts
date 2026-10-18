import type {
  AudioExportOptions,
  AudioFormat,
  CompressionMode,
} from "../types/audio.ts";
export const FORMATS: { value: AudioFormat; label: string }[] = [
  { value: "wav", label: "WAV" },
  { value: "aiff", label: "AIFF" },
  { value: "flac", label: "FLAC" },
  { value: "alac", label: "ALAC (M4A)" },
  { value: "mp3", label: "MP3" },
  { value: "ogg", label: "Ogg Vorbis" },
  { value: "opus", label: "Opus" },
  { value: "m4a", label: "AAC (M4A)" },
  { value: "aac", label: "AAC (ADTS)" },
  { value: "webm", label: "WebM Audio" },
  { value: "wma", label: "WMA" },
  { value: "ac3", label: "AC3" },
  { value: "raw_pcm", label: "Raw PCM (s16le)" },
];
export const defaultOptions = (): AudioExportOptions => ({
  format: "wav",
  compressionMode: "uncompressed",
  bitDepth: 16,
  bitrateKbps: 192,
  vbrQuality: 2,
  targetSizeMb: 8,
  flacCompressionLevel: 5,
  adpcmType: "ima_wav",
  embedLoopMetadata: true,
});
export const canEmbedLoop = (f: AudioFormat) =>
  ["wav", "aiff", "flac", "ogg", "opus"].includes(f);
export function modesFor(f: AudioFormat): CompressionMode[] {
  if (f === "wav") return ["uncompressed", "adpcm"];
  if (["aiff", "raw_pcm", "alac"].includes(f)) return ["uncompressed"];
  if (f === "flac") return ["flac_level"];
  if (f === "ogg") return ["lossy_vbr", "target_size"];
  if (["mp3", "opus", "webm"].includes(f))
    return ["lossy_cbr", "lossy_vbr", "target_size"];
  return ["lossy_cbr", "target_size"];
}
export function ratesFor(f: AudioFormat): number[] {
  if (["opus", "webm"].includes(f)) return [48000];
  if (f === "ac3") return [48000, 44100, 32000];
  if (f === "wma") return [48000, 44100, 32000, 22050, 16000];
  if (f === "mp3")
    return [48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];
  return [96000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 8000];
}
export function resolvedRate(options: AudioExportOptions, sourceRate: number) {
  const rates = ratesFor(options.format);
  if (options.sampleRate) {
    if (!rates.includes(options.sampleRate))
      throw new Error("Selected sample rate is not supported by this format.");
    return options.sampleRate;
  }
  return rates.includes(sourceRate) ||
    ["wav", "aiff", "flac", "raw_pcm", "alac"].includes(options.format)
    ? sourceRate
    : rates[0];
}
export function validateOptions(o: AudioExportOptions) {
  if (
    !FORMATS.some((f) => f.value === o.format) ||
    !modesFor(o.format).includes(o.compressionMode)
  )
    throw new Error("Unsupported format/compression combination.");
  if (
    o.targetSizeMb !== undefined &&
    (!Number.isFinite(o.targetSizeMb) ||
      o.targetSizeMb <= 0 ||
      o.targetSizeMb > 250)
  )
    throw new Error("Target size must be between 0 and 250 decimal MB.");
  if (
    o.bitrateKbps !== undefined &&
    (!Number.isFinite(o.bitrateKbps) ||
      o.bitrateKbps < 16 ||
      o.bitrateKbps > 320)
  )
    throw new Error("Bitrate must be 16–320 kbps.");
  if (o.channels !== undefined && o.channels !== 1 && o.channels !== 2)
    throw new Error("Select mono or stereo.");
  if (o.bitDepth !== undefined && ![16, 24, 32].includes(o.bitDepth))
    throw new Error("Invalid PCM bit depth.");
  if (
    o.vbrQuality !== undefined &&
    (!Number.isFinite(o.vbrQuality) ||
      o.vbrQuality < 0 ||
      o.vbrQuality > (o.format === "ogg" ? 10 : 9))
  )
    throw new Error("Invalid VBR quality.");
  if (
    o.flacCompressionLevel !== undefined &&
    (!Number.isInteger(o.flacCompressionLevel) ||
      o.flacCompressionLevel < 0 ||
      o.flacCompressionLevel > 8)
  )
    throw new Error("FLAC level must be 0–8.");
  if (
    o.audioStream !== undefined &&
    (!Number.isInteger(o.audioStream) || o.audioStream < 0)
  )
    throw new Error("Invalid audio track.");
  if (["flac", "alac"].includes(o.format) && o.bitDepth === 32)
    throw new Error("Choose 16 or 24 bits for FLAC/ALAC.");
  const c = o.dynamicRangeCompressor;
  if (
    c?.enabled &&
    (![c.thresholdDb, c.ratio, c.attackMs, c.releaseMs, c.makeupGainDb].every(
      Number.isFinite,
    ) ||
      c.thresholdDb < -40 ||
      c.thresholdDb > 0 ||
      c.ratio < 1 ||
      c.ratio > 20 ||
      c.attackMs < 1 ||
      c.attackMs > 100 ||
      c.releaseMs < 10 ||
      c.releaseMs > 1000 ||
      c.makeupGainDb < 0 ||
      c.makeupGainDb > 12)
  )
    throw new Error("Invalid compressor settings.");
}
export function outputExtension(f: AudioFormat) {
  return f === "raw_pcm" ? "raw" : f === "alac" ? "m4a" : f;
}
export function uniqueName(name: string, used: Set<string>) {
  const base = name.replace(/\.[^.]+$/, "");
  const ext = name.slice(base.length);
  let out = name;
  let n = 2;
  while (used.has(out.toLocaleLowerCase())) out = `${base} (${n++})${ext}`;
  used.add(out.toLocaleLowerCase());
  return out;
}
export const MAX_INPUT_BYTES = 128 * 1024 * 1024;
export const MAX_PCM_BYTES = 192 * 1024 * 1024;
export function checkInputSize(size: number) {
  if (size < 1) throw new Error("This file is empty.");
  if (size > MAX_INPUT_BYTES)
    throw new Error(
      "Files larger than 128 MiB are not supported in this browser workspace.",
    );
}
export function checkPcmBudget(
  frames: number,
  channels: number,
  multiplier = 1,
) {
  if (
    !Number.isSafeInteger(frames) ||
    frames < 1 ||
    channels < 1 ||
    channels > 2
  )
    throw new Error(
      "Only mono/stereo audio is supported; downmix multichannel audio in Batch first.",
    );
  if (frames * channels * 4 * multiplier > MAX_PCM_BYTES)
    throw new Error(
      "This operation exceeds the 192 MiB PCM memory budget. Use a shorter region or fewer repeats.",
    );
}
