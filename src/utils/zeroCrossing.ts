import { checkPcmBudget } from "./exportOptions.ts";
export interface ZeroCrossingResult {
  sample: number;
  timeSec: number;
  amplitude: number;
  found: boolean;
}
export function findNearestZeroCrossing(
  buffer: AudioBuffer,
  targetSample: number,
  searchRadius = 2500,
  slope: "rising" | "falling" | "any" = "rising",
  minSample = 0,
  maxSample = buffer.length - 1,
): ZeroCrossingResult {
  const target = Math.max(
    minSample,
    Math.min(maxSample, Math.round(targetSample)),
  );
  let best = target;
  let score = Infinity;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i),
  );
  for (
    let i = Math.max(minSample, 1, target - searchRadius);
    i <= Math.min(maxSample, buffer.length - 1, target + searchRadius);
    i++
  ) {
    const prev = channels[0][i - 1],
      next = channels[0][i];
    const rising = prev <= 0 && next >= 0,
      falling = prev >= 0 && next <= 0;
    if (
      !(slope === "any"
        ? rising || falling
        : slope === "rising"
          ? rising
          : falling)
    )
      continue;
    const candidate =
      channels.reduce(
        (sum, c) => sum + Math.abs(c[i]) + Math.abs(c[i] - c[i - 1]) * 0.1,
        0,
      ) +
      Math.abs(i - target) * 0.0001;
    if (candidate < score) {
      score = candidate;
      best = i;
    }
  }
  return {
    sample: best,
    timeSec: best / buffer.sampleRate,
    amplitude: channels[0][best],
    found: Number.isFinite(score),
  };
}
export function assertRegion(length: number, start: number, end: number) {
  if (
    ![start, end].every(Number.isSafeInteger) ||
    start < 0 ||
    end > length ||
    end <= start
  )
    throw new Error(
      "Loop start/end must be ordered whole frames inside the track.",
    );
}
/** Overlap mode shortens the loop by the overlap; convex gains prevent correlated-signal overshoot. */
export function createCrossfadedLoopBuffer(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  start: number,
  end: number,
  ms: number,
): AudioBuffer {
  assertRegion(source.length, start, end);
  if (!Number.isFinite(ms) || ms < 0 || ms > 250)
    throw new Error("Invalid crossfade.");
  const fade = Math.min(
    Math.floor((ms * source.sampleRate) / 1000),
    Math.floor((end - start) / 2),
  );
  const length = end - start - fade;
  checkPcmBudget(length, source.numberOfChannels);
  const out = ctx.createBuffer(
    source.numberOfChannels,
    length,
    source.sampleRate,
  );
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    const src = source.getChannelData(ch),
      dest = out.getChannelData(ch);
    dest.set(src.subarray(start, start + length));
    for (let i = 0; i < fade; i++) {
      const t = fade === 1 ? 0.5 : i / (fade - 1);
      dest[i] = src[end - fade + i] * (1 - t) + src[start + i] * t;
    }
  }
  return out;
}
export function createRepeatedBuffer(
  ctx: BaseAudioContext,
  loop: AudioBuffer,
  count: number,
): AudioBuffer {
  if (![1, 2, 4, 8].includes(count)) throw new Error("Invalid repeat count.");
  if (count === 1) return loop;
  checkPcmBudget(loop.length, loop.numberOfChannels, count);
  const out = ctx.createBuffer(
    loop.numberOfChannels,
    loop.length * count,
    loop.sampleRate,
  );
  for (let ch = 0; ch < loop.numberOfChannels; ch++)
    for (let r = 0; r < count; r++)
      out.getChannelData(ch).set(loop.getChannelData(ch), r * loop.length);
  return out;
}
