import { checkPcmBudget } from "./exportOptions.ts";
/** Float32 intermediate preserves headroom and avoids premature 16-bit quantization. */
export function audioBufferToWav(
  buffer: AudioBuffer,
  float32 = true,
): ArrayBuffer {
  checkPcmBudget(buffer.length, buffer.numberOfChannels);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i),
  );
  const bytes = float32 ? 4 : 2;
  const size = buffer.length * buffer.numberOfChannels * bytes;
  const out = new ArrayBuffer(44 + size);
  const v = new DataView(out);
  const text = (p: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + size, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, float32 ? 3 : 1, true);
  v.setUint16(22, channels.length, true);
  v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * channels.length * bytes, true);
  v.setUint16(32, channels.length * bytes, true);
  v.setUint16(34, bytes * 8, true);
  text(36, "data");
  v.setUint32(40, size, true);
  let p = 44;
  for (let i = 0; i < buffer.length; i++)
    for (const data of channels) {
      const s = data[i];
      if (!Number.isFinite(s))
        throw new Error("Audio contains non-finite samples.");
      if (float32) v.setFloat32(p, s, true);
      else {
        const n = Math.max(-1, Math.min(1, s));
        v.setInt16(p, Math.round(n * (n < 0 ? 32768 : 32767)), true);
      }
      p += bytes;
    }
  return out;
}
