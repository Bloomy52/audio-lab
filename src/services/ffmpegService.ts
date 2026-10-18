import type { AudioExportOptions, AudioInfo } from "../types/audio.ts";
import {
  injectLoopChunks,
  loopFromFrames,
  readAudioMetadata,
  validateLoop,
} from "../utils/audioMetadata.ts";
import {
  canEmbedLoop,
  checkInputSize,
  checkPcmBudget,
  outputExtension,
  resolvedRate,
  validateOptions,
} from "../utils/exportOptions.ts";
export interface Engine {
  load(config: Record<string, string>): Promise<unknown>;
  on(event: "log" | "progress", callback: (data: any) => void): void;
  off(event: "log" | "progress", callback: (data: any) => void): void;
  writeFile(path: string, data: Uint8Array): Promise<unknown>;
  readFile(path: string): Promise<Uint8Array | string>;
  deleteFile(path: string): Promise<unknown>;
  exec(args: string[], timeout?: number): Promise<number>;
  ffprobe(args: string[], timeout?: number): Promise<number>;
  terminate(): void;
}
export type Progress = (progress: number, message: string) => void;
const abortError = () => new DOMException("Operation cancelled.", "AbortError");
const isAbort = (e: unknown) =>
  e instanceof DOMException && e.name === "AbortError";
export class FFmpegService {
  private engine: Engine | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private factory: () => Promise<Engine>;
  private config: () => Record<string, string>;
  constructor(
    factory: () => Promise<Engine> = async () =>
      new (await import("@ffmpeg/ffmpeg")).FFmpeg() as unknown as Engine,
    config: () => Record<string, string> = () => ({
      coreURL: new URL(
        `${import.meta.env.BASE_URL}ffmpeg/ffmpeg-core.js`,
        document.baseURI,
      ).href,
      wasmURL: new URL(
        `${import.meta.env.BASE_URL}ffmpeg/ffmpeg-core.wasm`,
        document.baseURI,
      ).href,
    }),
  ) {
    this.factory = factory;
    this.config = config;
  }
  private async exclusive<T>(
    signal: AbortSignal | undefined,
    progress: Progress | undefined,
    operation: (engine: Engine, logs: string[]) => Promise<T>,
  ): Promise<T> {
    const run = async () => {
      if (signal?.aborted) throw abortError();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let expired = false;
      let cancel: () => void = () => {};
      const logs: string[] = [];
      let engine: Engine | undefined;
      const log = ({ message }: { message: string }) => {
        logs.push(message);
        if (logs.length > 400) logs.shift();
      };
      const update = ({ progress: p }: { progress: number }) => {
        if (Number.isFinite(p))
          progress?.(
            Math.min(99, Math.max(0, Math.round(p * 100))),
            "Encoding audio…",
          );
      };
      const work = async () => {
        if (!this.engine) {
          progress?.(0, "Loading local audio engine…");
          const candidate = await this.factory();
          if (signal?.aborted || expired) {
            candidate.terminate();
            throw abortError();
          }
          this.engine = candidate;
          await candidate.load(this.config());
        }
        if (signal?.aborted || expired) throw abortError();
        engine = this.engine!;
        engine.on("log", log);
        engine.on("progress", update);
        return operation(engine, logs);
      };
      try {
        return await Promise.race([
          work(),
          new Promise<never>((_, reject) => {
            cancel = () => {
              this.engine?.terminate();
              this.engine = null;
              reject(abortError());
            };
            signal?.addEventListener("abort", cancel, { once: true });
            timer = setTimeout(() => {
              expired = true;
              this.engine?.terminate();
              this.engine = null;
              reject(
                new Error(
                  "Audio processing timed out. Try a shorter file or fewer effects. You can retry.",
                ),
              );
            }, 240000);
          }),
        ]);
      } catch (err) {
        this.engine?.terminate();
        this.engine = null;
        if (isAbort(err)) throw err;
        throw new Error(err instanceof Error ? err.message : String(err));
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        engine?.off("log", log);
        engine?.off("progress", update);
        // Release the WASM heap and codec globals after each job. Some codec
        // combinations retain unsafe native state across repeated exec calls.
        if (engine && this.engine === engine) {
          engine.terminate();
          this.engine = null;
        }
      }
    };
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => {});
    if (!signal) return result;
    // A queued job must be cancellable without waiting for somebody else's job.
    return new Promise<T>((resolve, reject) => {
      const queuedAbort = () => reject(abortError());
      signal.addEventListener("abort", queuedAbort, { once: true });
      if (signal.aborted) queuedAbort();
      result.then(
        (value) => {
          signal.removeEventListener("abort", queuedAbort);
          resolve(value);
        },
        (err) => {
          signal.removeEventListener("abort", queuedAbort);
          reject(err);
        },
      );
    });
  }
  private async exec(engine: Engine, args: string[], logs: string[]) {
    logs.length = 0;
    const code = await engine.exec(args, 180000);
    if (code !== 0) {
      const details = logs
        .filter((s) =>
          /error|invalid|unknown|supported|could not|failed|memory/i.test(s),
        )
        .slice(-5)
        .join("\n");
      throw new Error(
        `Encoding failed (${code}). ${details || logs.slice(-3).join("\n") || "Check the input file and format settings."}`,
      );
    }
  }
  private async clean(engine: Engine, names: string[]) {
    await Promise.allSettled(names.map((n) => engine.deleteFile(n)));
  }
  private async inspect(
    engine: Engine,
    name: string,
    bytes: Uint8Array,
    stream: number,
    logs: string[],
  ): Promise<AudioInfo> {
    const output = `probe_${crypto.randomUUID()}.json`;
    let probe: any;
    try {
      logs.length = 0;
      const code = await engine.ffprobe(
        [
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          "-o",
          output,
          name,
        ],
        30000,
      );
      if (code !== 0 && code !== -1)
        throw new Error(
          `Encoding failed: cannot inspect this input. ${logs.slice(-4).join(" ")}`,
        ); // Core 0.12.10 can return -1 even after writing a valid ffprobe JSON result; validate that result.
      const raw = await engine.readFile(output);
      probe = JSON.parse(
        typeof raw === "string" ? raw : new TextDecoder().decode(raw),
      );
    } finally {
      await this.clean(engine, [output]);
    }
    const audio = (probe.streams ?? []).filter(
      (s: any) => s.codec_type === "audio",
    );
    const selected = audio[stream];
    if (!selected)
      throw new Error(
        "Encoding failed: no selected audio stream was found in this file.",
      );
    const rate = Number(selected.sample_rate);
    const count = Number(selected.channels);
    const meta = readAudioMetadata(bytes, rate);
    let duration = Number(selected.duration ?? probe.format?.duration);
    if (meta.frames && meta.sampleRate)
      duration = meta.frames / meta.sampleRate;
    if (!rate || !count || !Number.isFinite(duration) || duration <= 0)
      throw new Error(
        "Could not determine a usable duration, sample rate, and channel layout.",
      );
    const warnings = [...meta.warnings];
    let loop = stream === 0 ? meta.loop : undefined;
    if (stream !== 0 && meta.loop)
      warnings.push(
        "Source loop markers were ignored for a different audio stream.",
      );
    const frames = meta.frames ?? Math.round(duration * rate);
    if (loop) {
      try {
        validateLoop(loop, frames);
      } catch (err) {
        warnings.push(String(err));
        loop = undefined;
      }
    }
    return {
      sampleRate: rate,
      channels: count,
      duration,
      frames,
      streams: audio.map((s: any, index: number) => ({
        index,
        description: `Track ${index + 1}: ${s.codec_name}, ${s.sample_rate} Hz, ${s.channels} channel(s)${s.tags?.language ? `, ${s.tags.language}` : ""}`,
      })),
      loop,
      warnings,
    };
  }

  async inspectAudio(
    data: Uint8Array,
    ext: string,
    stream = 0,
    signal?: AbortSignal,
    onProgress?: Progress,
  ): Promise<AudioInfo> {
    checkInputSize(data.length);
    return this.exclusive(signal, onProgress, async (engine, logs) => {
      const name = `probe_${crypto.randomUUID()}.${this.safeExt(ext)}`;
      try {
        await engine.writeFile(name, new Uint8Array(data));
        return await this.inspect(engine, name, data, stream, logs);
      } finally {
        await this.clean(engine, [name]);
      }
    });
  }
  async decodeAudio(
    data: Uint8Array,
    ext: string,
    info: AudioInfo,
    stream = 0,
    signal?: AbortSignal,
    onProgress?: Progress,
  ): Promise<Uint8Array> {
    checkPcmBudget(Math.ceil(info.duration * info.sampleRate), info.channels);
    return this.exclusive(signal, onProgress, async (engine, logs) => {
      const id = crypto.randomUUID(),
        input = `decode_${id}.${this.safeExt(ext)}`,
        out = `decoded_${id}.wav`;
      try {
        await engine.writeFile(input, new Uint8Array(data));
        await this.exec(
          engine,
          [
            "-i",
            input,
            "-map",
            `0:a:${stream}`,
            "-vn",
            "-sn",
            "-dn",
            "-ar",
            String(info.sampleRate),
            "-c:a",
            "pcm_f32le",
            out,
          ],
          logs,
        );
        return ((await engine.readFile(out)) as Uint8Array).slice();
      } finally {
        await this.clean(engine, [input, out]);
      }
    });
  }
  private safeExt(ext: string) {
    return /^[a-z0-9]{1,8}$/i.test(ext) ? ext : "bin";
  }
  calculateTargetBitrate(size: number, duration: number) {
    if (!(size > 0 && duration > 0))
      throw new Error("A valid duration and target size are required.");
    return Math.floor(((size * 1_000_000 * 8) / duration / 1000) * 0.94);
  }
  async transcodeAudio(
    inputData: Uint8Array,
    inputExt: string,
    options: AudioExportOptions,
    _durationSec?: number,
    onProgress?: Progress,
    loopOverride?: { loopStartSample: number; loopEndSample: number },
    signal?: AbortSignal,
  ): Promise<{
    blob: Blob;
    fileName: string;
    format: string;
    warnings: string[];
    info: AudioInfo;
  }> {
    checkInputSize(inputData.length);
    validateOptions(options);
    return this.exclusive(signal, onProgress, async (engine, logs) => {
      const id = crypto.randomUUID(),
        input = `input_${id}.${this.safeExt(inputExt)}`,
        output = `output_${id}.${outputExtension(options.format)}`;
      try {
        await engine.writeFile(input, new Uint8Array(inputData));
        onProgress?.(0, "Inspecting source audio…");
        const info = await this.inspect(
          engine,
          input,
          inputData,
          options.audioStream ?? 0,
          logs,
        );
        const rate = resolvedRate(options, info.sampleRate);
        const warnings = [...info.warnings];
        if (rate !== info.sampleRate && !options.sampleRate)
          warnings.push(
            `This codec requires resampling from ${info.sampleRate} to ${rate} Hz.`,
          );
        const channels = options.channels ?? info.channels;
        if (channels > 2)
          throw new Error(
            "Select mono or stereo to downmix this multichannel source.",
          );
        let loop = loopOverride
          ? loopFromFrames(
              loopOverride.loopStartSample,
              loopOverride.loopEndSample,
              info.sampleRate,
            )
          : info.loop;
        if (loop)
          validateLoop(
            loop,
            info.frames ?? Math.round(info.duration * info.sampleRate),
          );
        if (loop && options.embedLoopMetadata && !canEmbedLoop(options.format))
          warnings.push(
            "This output format does not support Audio Lab loop markers.",
          );
        if (loop) {
          loop = loopFromFrames(
            Math.round((loop.loopStartSample * rate) / info.sampleRate),
            Math.round((loop.loopEndSample * rate) / info.sampleRate),
            rate,
          );
        }
        let bitrate = options.bitrateKbps ?? 192;
        const target =
          options.compressionMode === "target_size"
            ? Math.floor((options.targetSizeMb ?? 8) * 1_000_000)
            : undefined;
        if (target) {
          bitrate = this.calculateTargetBitrate(
            options.targetSizeMb ?? 8,
            info.duration,
          );
          if (bitrate < 16)
            throw new Error(
              "That size budget is too small for this duration. Choose a larger size or shorter audio.",
            );
          bitrate = Math.min(320, bitrate);
        }
        let bytes: Uint8Array | undefined;
        for (let attempt = 0; attempt < (target ? 4 : 1); attempt++) {
          const args = [
            "-i",
            input,
            "-map",
            `0:a:${options.audioStream ?? 0}`,
            "-vn",
            "-sn",
            "-dn",
            "-map_metadata",
            "-1",
            "-ar",
            String(rate),
            "-ac",
            String(channels),
          ];
          const filters: string[] = [];
          const c = options.dynamicRangeCompressor;
          if (c?.enabled)
            filters.push(
              `acompressor=threshold=${c.thresholdDb}dB:ratio=${c.ratio}:attack=${c.attackMs}:release=${c.releaseMs}:makeup=${c.makeupGainDb}dB`,
            );
          if (options.normalizeLufs)
            filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
          if (c?.enabled || options.normalizeLufs)
            filters.push("alimiter=limit=0.98:level=false:latency=true");
          if (filters.length) args.push("-af", filters.join(","));
          this.codec(args, options, bitrate);
          if (
            options.embedLoopMetadata &&
            loop &&
            ["flac", "ogg", "opus"].includes(options.format)
          )
            args.push(
              "-metadata",
              `LOOPSTART=${loop.loopStartSample}`,
              "-metadata",
              `LOOPLENGTH=${loop.loopLengthSamples}`,
            );
          args.push(output);
          onProgress?.(
            0,
            target
              ? `Encoding size-checked output (attempt ${attempt + 1})…`
              : "Encoding audio…",
          );
          await this.exec(engine, args, logs);
          bytes = ((await engine.readFile(output)) as Uint8Array).slice();
          if (
            options.embedLoopMetadata &&
            loop &&
            (options.format === "wav" || options.format === "aiff")
          )
            bytes = injectLoopChunks(bytes, options.format, loop, rate);
          if (!target || bytes.length <= target) break;
          bitrate = Math.floor(((bitrate * target) / bytes.length) * 0.9);
          if (bitrate < 16)
            throw new Error(
              "The requested size cannot be reached with this format and duration.",
            );
        }
        if (!bytes?.length)
          throw new Error("The encoder produced an empty file.");
        if (target && bytes.length > target)
          throw new Error(
            "Unable to meet the requested size. Try a larger budget or another format.",
          );
        onProgress?.(100, "Export complete");
        const mime: Partial<Record<string, string>> = {
          wav: "audio/wav",
          aiff: "audio/aiff",
          flac: "audio/flac",
          mp3: "audio/mpeg",
          ogg: "audio/ogg",
          opus: "audio/ogg",
          m4a: "audio/mp4",
          alac: "audio/mp4",
          aac: "audio/aac",
          webm: "audio/webm",
          wma: "audio/x-ms-wma",
        };
        return {
          blob: new Blob([bytes.buffer as ArrayBuffer], {
            type: mime[options.format] ?? "application/octet-stream",
          }),
          fileName: output,
          format: options.format,
          warnings,
          info: { ...info, sampleRate: rate, channels, loop },
        };
      } finally {
        await this.clean(engine, [input, output]);
      }
    });
  }
  private codec(a: string[], o: AudioExportOptions, bitrate: number) {
    const vbr = o.compressionMode === "lossy_vbr";
    const rate = `${bitrate}k`;
    const bits = o.bitDepth ?? 16;
    switch (o.format) {
      case "wav":
        a.push(
          "-c:a",
          o.compressionMode === "adpcm"
            ? `adpcm_${o.adpcmType === "ms" ? "ms" : o.adpcmType === "yamaha" ? "yamaha" : "ima_wav"}`
            : `pcm_s${bits}le`,
        );
        break;
      case "aiff":
        a.push("-c:a", `pcm_s${bits}be`);
        break;
      case "raw_pcm":
        a.push("-f", "s16le", "-c:a", "pcm_s16le");
        break;
      case "flac":
        a.push(
          "-c:a",
          "flac",
          "-sample_fmt",
          bits === 16 ? "s16" : "s32",
          "-compression_level",
          String(o.flacCompressionLevel ?? 5),
        );
        break;
      case "alac":
        a.push("-c:a", "alac", "-sample_fmt", bits === 16 ? "s16p" : "s32p");
        break;
      case "mp3":
        a.push(
          "-c:a",
          "libmp3lame",
          vbr ? "-q:a" : "-b:a",
          vbr ? String(o.vbrQuality ?? 2) : rate,
        );
        break;
      case "ogg":
        a.push(
          "-c:a",
          "libvorbis",
          vbr ? "-q:a" : "-b:a",
          vbr ? String(o.vbrQuality ?? 5) : rate,
        );
        break;
      case "opus":
      case "webm":
        a.push(
          "-c:a",
          "libopus",
          "-b:a",
          rate,
          "-frame_duration",
          "10",
          "-vbr",
          vbr ? "on" : "off",
        );
        break;
      case "m4a":
      case "aac":
        a.push("-c:a", "aac", "-b:a", rate);
        break;
      case "wma":
        a.push("-c:a", "wmav2", "-b:a", rate);
        break;
      case "ac3":
        a.push("-c:a", "ac3", "-b:a", rate);
        break;
    }
  }
}
export const ffmpegService = new FFmpegService();
