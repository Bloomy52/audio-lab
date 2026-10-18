import { audioBufferToWav } from "../src/utils/wavEncoder.ts";
export function buffer(channels, rate = 48000) {
  const arrays = channels.map((c) => Float32Array.from(c));
  return {
    length: arrays[0].length,
    sampleRate: rate,
    numberOfChannels: arrays.length,
    duration: arrays[0].length / rate,
    getChannelData: (ch) => arrays[ch],
  };
}
export const ctx = {
  createBuffer: (n, length, rate) =>
    buffer(
      Array.from({ length: n }, () => new Float32Array(length)),
      rate,
    ),
};
export function sine(seconds = 1, rate = 48000) {
  const data = Float32Array.from(
    { length: Math.round(seconds * rate) },
    (_, i) => Math.sin((i * 2 * Math.PI * 440) / rate) * 0.5,
  );
  return new Uint8Array(audioBufferToWav(buffer([data, data], rate)));
}
