import type { LoopMetadata } from "../types/audio.ts";
export interface MetadataResult {
  sampleRate?: number;
  frames?: number;
  loop?: LoopMetadata;
  warnings: string[];
}
const text = (v: DataView, p: number, n: number) =>
  new TextDecoder("latin1").decode(
    new Uint8Array(v.buffer, v.byteOffset + p, n),
  );
export function loopFromFrames(
  start: number,
  end: number,
  rate: number,
  source: LoopMetadata["source"] = "user",
): LoopMetadata {
  if (
    ![start, end, rate].every(Number.isSafeInteger) ||
    rate <= 0 ||
    start < 0 ||
    end <= start
  )
    throw new Error("Invalid loop frame bounds.");
  return {
    loopStartSample: start,
    loopEndSample: end,
    loopLengthSamples: end - start,
    loopStartTimeSec: start / rate,
    loopEndTimeSec: end / rate,
    source,
  };
}
export function validateLoop(loop: LoopMetadata, frames: number) {
  if (
    !Number.isSafeInteger(frames) ||
    frames < 1 ||
    loop.loopStartSample < 0 ||
    loop.loopEndSample > frames ||
    loop.loopStartSample >= loop.loopEndSample
  )
    throw new Error(
      "Loop markers fall outside the audio. Please correct them before exporting.",
    );
}
function extended80(v: DataView, p: number) {
  const exp = v.getUint16(p, false);
  return (
    (exp & 0x8000 ? -1 : 1) *
    (v.getUint32(p + 2, false) * 2 ** 32 + v.getUint32(p + 6, false)) *
    2 ** ((exp & 0x7fff) - 16383 - 63)
  );
}
export function readAudioMetadata(
  bytes: Uint8Array,
  fallbackRate?: number,
): MetadataResult {
  const result: MetadataResult = { warnings: [] };
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let bounds: [number, number] | undefined;
  let source: LoopMetadata["source"];
  const comments = new Map<string, string>();
  const readComments = (data: Uint8Array, offset: number) => {
    const cv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let p = offset;
    const uint = () => {
      if (p + 4 > data.length) throw new Error("Truncated comment packet");
      const n = cv.getUint32(p, true);
      p += 4;
      return n;
    };
    const vendor = uint();
    p += vendor;
    const count = uint();
    if (count > 100000) throw new Error("Too many metadata comments");
    for (let i = 0; i < count; i++) {
      const n = uint();
      if (p + n > data.length) throw new Error("Truncated metadata comment");
      const s = new TextDecoder().decode(data.subarray(p, p + n));
      p += n;
      const eq = s.indexOf("=");
      if (eq > 0)
        comments.set(
          s.slice(0, eq).toUpperCase().replaceAll("_", ""),
          s.slice(eq + 1),
        );
    }
  };
  try {
    if (bytes.length < 12) return result;
    const magic = text(v, 0, 4);
    if (
      (magic === "RIFF" && text(v, 8, 4) === "WAVE") ||
      (magic === "FORM" && ["AIFF", "AIFC"].includes(text(v, 8, 4)))
    ) {
      const le = magic === "RIFF";
      const limit = v.getUint32(4, le) + 8;
      if (limit > bytes.length || limit < 12)
        throw new Error("Invalid container length");
      const markers = new Map<number, number>();
      let sustain: [number, number] | undefined;
      let o = 12;
      let blockAlign = 0;
      let pcm = false;
      while (o + 8 <= limit) {
        const id = text(v, o, 4);
        const n = v.getUint32(o + 4, le);
        const p = o + 8;
        const end = p + n;
        if (end > limit) throw new Error(`Truncated ${id} chunk`);
        if (le && id === "fmt " && n >= 16) {
          result.sampleRate = v.getUint32(p + 4, true);
          blockAlign = v.getUint16(p + 12, true);
          pcm = [1, 3, 65534].includes(v.getUint16(p, true));
        }
        if (le && id === "data" && pcm && blockAlign)
          result.frames = Math.floor(n / blockAlign);
        if (!le && id === "COMM" && n >= 18) {
          result.frames = v.getUint32(p + 2, false);
          result.sampleRate = Math.round(extended80(v, p + 8));
        }
        if (le && id === "smpl") {
          if (n < 36) throw new Error("Short smpl chunk");
          const count = v.getUint32(p + 28, true);
          if (36 + count * 24 > n) throw new Error("Truncated sampler loops");
          if (count > 1)
            result.warnings.push(
              "Only the first forward sustain loop is used; additional loops are not preserved.",
            );
          if (count) {
            if (
              v.getUint32(p + 40, true) !== 0 ||
              v.getUint32(p + 52, true) !== 0 ||
              v.getUint32(p + 56, true) !== 0
            )
              result.warnings.push(
                "Unsupported reverse/ping-pong, fractional, or finite loop ignored.",
              );
            else {
              bounds = [
                v.getUint32(p + 44, true),
                v.getUint32(p + 48, true) + 1,
              ];
              source = "wav_smpl";
            }
          }
        }
        if (!le && id === "MARK") {
          if (n < 2) throw new Error("Short MARK chunk");
          let m = p + 2;
          const count = v.getUint16(p, false);
          for (let i = 0; i < count; i++) {
            if (m + 7 > end) throw new Error("Truncated AIFF marker");
            const id = v.getInt16(m, false);
            const pos = v.getUint32(m + 2, false);
            const len = v.getUint8(m + 6);
            const strSize = 1 + len;
            const next = m + 6 + strSize + (strSize % 2);
            if (next > end) throw new Error("Truncated marker string");
            markers.set(id, pos);
            m = next;
          }
        }
        if (!le && id === "INST") {
          if (n < 20) throw new Error("Short INST chunk");
          const mode = v.getUint16(p + 8, false);
          if (mode === 1)
            sustain = [v.getInt16(p + 10, false), v.getInt16(p + 12, false)];
          else if (mode)
            result.warnings.push(
              "Ping-pong AIFF sustain loops are not supported and were ignored.",
            );
          if (v.getUint16(p + 14, false))
            result.warnings.push("AIFF release loops are not preserved.");
        }
        o = end + (n % 2);
      }
      if (sustain) {
        const a = markers.get(sustain[0]);
        const b = markers.get(sustain[1]);
        if (a === undefined || b === undefined)
          throw new Error("AIFF loop refers to missing markers");
        bounds = [a, b];
        source = "aiff_inst";
      }
    } else if (magic === "fLaC") {
      let o = 4;
      let last = false;
      while (!last) {
        if (o + 4 > bytes.length) throw new Error("Truncated FLAC metadata");
        last = !!(bytes[o] & 128);
        const type = bytes[o] & 127;
        const n = (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3];
        const p = o + 4;
        if (p + n > bytes.length) throw new Error("Truncated FLAC block");
        if (type === 0 && n === 34) {
          const packed = v.getBigUint64(p + 10, false);
          result.sampleRate = Number(packed >> 44n);
          result.frames = Number(packed & ((1n << 36n) - 1n));
        }
        if (type === 4) readComments(bytes.subarray(p, p + n), 0);
        o = p + n;
      }
      source = "flac_comment";
    } else if (magic === "OggS") {
      // Reassemble packets by logical stream. Comments can span pages or follow large artwork.
      const packets = new Map<number, number[]>();
      let o = 0;
      let scanned = 0;
      while (o + 27 <= bytes.length && scanned < 16 * 1024 * 1024) {
        if (text(v, o, 4) !== "OggS") throw new Error("Invalid Ogg page");
        const serial = v.getUint32(o + 14, true);
        const count = bytes[o + 26];
        const p = o + 27;
        if (p + count > bytes.length) throw new Error("Truncated Ogg lacing");
        let q = p + count;
        let packet = packets.get(serial) ?? [];
        for (let i = 0; i < count; i++) {
          const n = bytes[p + i];
          if (q + n > bytes.length) throw new Error("Truncated Ogg packet");
          for (const b of bytes.subarray(q, q + n)) packet.push(b);
          q += n;
          if (packet.length > 16 * 1024 * 1024)
            throw new Error("Ogg metadata too large");
          if (n < 255) {
            const data = Uint8Array.from(packet);
            const sig = new TextDecoder("latin1").decode(data.subarray(0, 8));
            if (sig.startsWith("\x01vorbis") && data.length >= 16)
              result.sampleRate = new DataView(data.buffer).getUint32(12, true);
            if (sig === "OpusHead") result.sampleRate = 48000;
            if (sig.startsWith("\x03vorbis")) readComments(data, 7);
            if (sig === "OpusTags") readComments(data, 8);
            packet = [];
          }
        }
        packets.set(serial, packet);
        scanned += q - o;
        o = q;
        if (comments.has("LOOPSTART")) break;
      }
      source = "ogg_comment";
    }
    if (comments.has("LOOPSTART")) {
      const parse = (key: string) => {
        const s = comments.get(key);
        if (s === undefined) return undefined;
        if (!/^\d+$/.test(s)) throw new Error(`Invalid ${key}`);
        const n = Number(s);
        if (!Number.isSafeInteger(n)) throw new Error(`Invalid ${key}`);
        return n;
      };
      const start = parse("LOOPSTART")!;
      const len = parse("LOOPLENGTH");
      const end = parse("LOOPEND");
      if (len !== undefined) bounds = [start, start + len];
      else if (end !== undefined) bounds = [start, end];
    }
    const rate = result.sampleRate ?? fallbackRate;
    if (bounds) {
      if (!rate)
        throw new Error("Source sample rate required for loop metadata");
      result.loop = loopFromFrames(bounds[0], bounds[1], rate, source);
      if (result.frames) validateLoop(result.loop, result.frames);
    }
  } catch (err) {
    result.loop = undefined;
    result.warnings.push(
      `Loop metadata could not be used: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return result;
}
export async function parseLoopMetadata(file: File, sampleRate?: number) {
  return readAudioMetadata(new Uint8Array(await file.arrayBuffer()), sampleRate)
    .loop;
}
export function createWavSmplChunk(
  start: number,
  endExclusive: number,
  rate = 48000,
): Uint8Array {
  loopFromFrames(start, endExclusive, rate);
  const b = new Uint8Array(68);
  const v = new DataView(b.buffer);
  b.set(new TextEncoder().encode("smpl"));
  v.setUint32(4, 60, true);
  v.setUint32(16, Math.round(1e9 / rate), true);
  v.setUint32(20, 60, true);
  v.setUint32(36, 1, true);
  v.setUint32(52, start, true);
  v.setUint32(56, endExclusive - 1, true);
  return b;
}
export function createAiffLoopChunks(start: number, end: number): Uint8Array {
  loopFromFrames(start, end, 48000);
  const mark = new Uint8Array(34);
  const v = new DataView(mark.buffer);
  mark.set(new TextEncoder().encode("MARK"));
  v.setUint32(4, 26, false);
  v.setUint16(8, 2, false);
  // Both labels have four characters: length byte + 4 bytes + one pad.
  for (const [offset, id, pos] of [
    [10, 1, start],
    [22, 2, end],
  ]) {
    v.setInt16(offset, id, false);
    v.setUint32(offset + 2, pos, false);
    mark[offset + 6] = 4;
    mark.set(new TextEncoder().encode("Loop"), offset + 7);
  }
  const inst = new Uint8Array(28);
  inst.set(new TextEncoder().encode("INST"));
  const iv = new DataView(inst.buffer);
  iv.setUint32(4, 20, false);
  inst[8] = 60;
  inst[11] = 127;
  inst[13] = 127;
  iv.setUint16(16, 1, false);
  iv.setInt16(18, 1, false);
  iv.setInt16(20, 2, false);
  const out = new Uint8Array(62);
  out.set(mark);
  out.set(inst, 34);
  return out;
}
export function injectLoopChunks(
  data: Uint8Array,
  format: "wav" | "aiff",
  loop: LoopMetadata,
  rate: number,
): Uint8Array {
  const le = format === "wav";
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 12 || text(v, 0, 4) !== (le ? "RIFF" : "FORM"))
    throw new Error("Invalid output container for loop metadata");
  const parts: Uint8Array[] = [data.slice(0, 12)];
  let o = 12;
  while (o + 8 <= data.length) {
    const n = v.getUint32(o + 4, le);
    const end = o + 8 + n + (n % 2);
    if (end > data.length) throw new Error("Truncated output chunk");
    const id = text(v, o, 4);
    if (!["smpl", "MARK", "INST"].includes(id)) parts.push(data.slice(o, end));
    o = end;
  }
  parts.push(
    le
      ? createWavSmplChunk(loop.loopStartSample, loop.loopEndSample, rate)
      : createAiffLoopChunks(loop.loopStartSample, loop.loopEndSample),
  );
  const size = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  new DataView(out.buffer).setUint32(4, size - 8, le);
  return out;
}
