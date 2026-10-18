import { checkPcmBudget } from "./exportOptions.ts";
/** Write directly into float WAV output to avoid full repeated AudioBuffer copies. */
export function prepareAudio(
  channels: Float32Array[],
  sampleRate: number,
  crossfadeMs: number,
  repeats: number,
) {
  if (
    !channels.length ||
    channels.some((c) => c.length !== channels[0].length) ||
    !Number.isFinite(crossfadeMs) ||
    crossfadeMs < 0 ||
    crossfadeMs > 250 ||
    ![1, 2, 4, 8].includes(repeats)
  )
    throw new Error("Invalid loop preparation parameters.");
  const length = channels[0].length;
  checkPcmBudget(length, channels.length, 1 + repeats);
  const fade = Math.min(
    Math.floor((crossfadeMs * sampleRate) / 1000),
    Math.floor(length / 2),
  );
  const loopFrames = length - fade;
  const frames = loopFrames * repeats;
  const size = frames * channels.length * 4;
  const wav = new ArrayBuffer(44 + size);
  const view = new DataView(wav);
  const text = (p: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(p + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + size, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels.length * 4, true);
  view.setUint16(32, channels.length * 4, true);
  view.setUint16(34, 32, true);
  text(36, "data");
  view.setUint32(40, size, true);
  let p = 44;
  for (let i = 0; i < frames; i++) {
    const frame = i % loopFrames;
    const t = fade === 1 ? 0.5 : frame / (fade - 1);
    for (const channel of channels) {
      const value =
        frame < fade
          ? channel[length - fade + frame] * (1 - t) + channel[frame] * t
          : channel[frame];
      if (!Number.isFinite(value)) throw new Error("Non-finite audio sample.");
      view.setFloat32(p, value, true);
      p += 4;
    }
  }
  return { wav, loopFrames, frames };
}
