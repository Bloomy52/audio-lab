import { checkPcmBudget } from "../utils/exportOptions";
import { assertRegion } from "../utils/zeroCrossing";
export async function prepareInWorker(
  buffer: AudioBuffer,
  start: number,
  end: number,
  crossfadeMs: number,
  repeats: number,
  signal?: AbortSignal,
): Promise<{ wav: ArrayBuffer; loopFrames: number; frames: number }> {
  assertRegion(buffer.length, start, end);
  checkPcmBudget(
    buffer.length + (end - start) * (1 + repeats),
    buffer.numberOfChannels,
  );
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const worker = new Worker(
    new URL("./audioPreparation.worker.ts", import.meta.url),
    { type: "module" },
  );
  return new Promise((resolve, reject) => {
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
      clearTimeout(timer);
    };
    const abort = () => {
      finish();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("Audio preparation timed out."));
    }, 60000);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || "Audio preparation failed."));
    };
    worker.onmessage = ({ data }) => {
      finish();
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, ch) =>
      buffer.getChannelData(ch).slice(start, end),
    );
    worker.postMessage(
      { channels, sampleRate: buffer.sampleRate, crossfadeMs, repeats },
      { transfer: channels.map((c) => c.buffer) },
    );
  });
}
