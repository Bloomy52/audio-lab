import { prepareAudio } from "../utils/prepareAudio";
self.onmessage = ({
  data,
}: {
  data: {
    channels: Float32Array[];
    sampleRate: number;
    crossfadeMs: number;
    repeats: number;
  };
}) => {
  try {
    const result = prepareAudio(
      data.channels,
      data.sampleRate,
      data.crossfadeMs,
      data.repeats,
    );
    self.postMessage(result, { transfer: [result.wav] });
  } catch (err) {
    self.postMessage({
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
