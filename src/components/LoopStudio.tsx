import { useEffect, useRef, useState } from "react";
import type {
  AudioExportOptions,
  LoadedAudioTrack,
  DynamicRangeCompressorConfig,
} from "../types/audio";
import { ffmpegService } from "../services/ffmpegService";
import { prepareInWorker } from "../services/prepareService";
import {
  checkInputSize,
  checkPcmBudget,
  defaultOptions,
} from "../utils/exportOptions";
import { AudioStudioPlayer } from "../utils/audioPlayer";
import { findNearestZeroCrossing, assertRegion } from "../utils/zeroCrossing";
import { validateLoop } from "../utils/audioMetadata";
import { ExportSettings } from "./ExportSettings";
import { WaveformVisualizer } from "./WaveformVisualizer";
const compressorDefault: DynamicRangeCompressorConfig = {
  enabled: false,
  thresholdDb: -18,
  ratio: 4,
  attackMs: 20,
  releaseMs: 250,
  makeupGainDb: 2,
};
interface ExportResult {
  url: string;
  name: string;
  revision: string;
  warnings: string[];
  sampleRate: number;
  channels: number;
}
export function LoopStudio({ active = true }: { active?: boolean }) {
  const [track, setTrack] = useState<LoadedAudioTrack | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(1);
  const [draftStart, setDraftStart] = useState("0");
  const [draftEnd, setDraftEnd] = useState("1");
  const [playing, setPlaying] = useState(false);
  const [looping, setLooping] = useState(true);
  const [time, setTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [options, setOptions] = useState<AudioExportOptions>(defaultOptions);
  const [compressor, setCompressor] = useState(compressorDefault);
  const [regionOnly, setRegionOnly] = useState(false);
  const [crossfade, setCrossfade] = useState(0);
  const [repeats, setRepeats] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ExportResult | null>(null);
  const [prepared, setPrepared] = useState(false);
  const player = useRef<AudioStudioPlayer | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const loadController = useRef<AbortController | null>(null);
  const exportController = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const exportLock = useRef(false);
  const resultUrl = useRef<string | null>(null);
  useEffect(() => {
    const p = new AudioStudioPlayer();
    player.current = p;
    p.onTimeUpdate(setTime);
    p.onStateChange(setPlaying);
    return () => {
      generation.current++;
      loadController.current?.abort();
      exportController.current?.abort();
      p.dispose();
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    };
  }, []);
  useEffect(() => {
    if (!active) player.current?.pause();
  }, [active]);
  useEffect(() => {
    setDraftStart(String(start));
    setDraftEnd(String(end));
  }, [start, end]);
  useEffect(() => {
    if (track) {
      player.current?.loadBuffer(
        track.audioBuffer,
        start / track.sampleRate,
        end / track.sampleRate,
      );
      setPrepared(false);
    }
  }, [track, start, end, crossfade, repeats]);
  useEffect(() => {
    player.current?.setLooping(looping);
  }, [looping]);
  const revision = JSON.stringify({
    id: track?.id,
    start,
    end,
    options,
    compressor,
    regionOnly,
    crossfade,
    repeats,
  });
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        e.repeat ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        document.querySelector("dialog[open]") ||
        t.closest('button,a,input,select,textarea,[contenteditable="true"]')
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        void player.current?.togglePlay().catch((err) => setError(String(err)));
      }
      if (e.key.toLowerCase() === "l") {
        e.preventDefault();
        setLooping((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active]);
  async function load(file: File, stream = 0) {
    if (exportLock.current) return;
    loadController.current?.abort();
    const abort = new AbortController();
    loadController.current = abort;
    const token = ++generation.current;
    setLoading(true);
    setError("");
    player.current?.pause();
    try {
      checkInputSize(file.size);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ext = file.name.split(".").pop() ?? "bin";
      const info = await ffmpegService.inspectAudio(
        bytes,
        ext,
        stream,
        abort.signal,
        (p, s) => {
          if (token === generation.current) {
            setProgress(p);
            setStatus(s);
          }
        },
      );
      checkPcmBudget(
        Math.ceil(info.duration * info.sampleRate),
        info.channels,
        3,
      );
      // Decode in a source-rate context, not the output-device context.
      const context = new OfflineAudioContext(
        info.channels,
        1,
        info.sampleRate,
      );
      let buffer: AudioBuffer;
      if (stream === 0) {
        try {
          buffer = await context.decodeAudioData(bytes.slice().buffer);
        } catch {
          const pcm = await ffmpegService.decodeAudio(
            bytes,
            ext,
            info,
            stream,
            abort.signal,
          );
          buffer = await context.decodeAudioData(pcm.buffer as ArrayBuffer);
        }
      } else {
        const pcm = await ffmpegService.decodeAudio(
          bytes,
          ext,
          info,
          stream,
          abort.signal,
        );
        buffer = await context.decodeAudioData(pcm.buffer as ArrayBuffer);
      }
      if (abort.signal.aborted || token !== generation.current) return;
      checkPcmBudget(buffer.length, buffer.numberOfChannels, 3);
      let detected = info.loop;
      if (detected) {
        try {
          validateLoop(detected, buffer.length);
        } catch (err) {
          info.warnings.push(String(err));
          detected = undefined;
        }
      }
      setOptions((v) => ({ ...v, audioStream: stream }));
      setTrack({
        id: crypto.randomUUID(),
        name: file.name,
        file,
        audioBuffer: buffer,
        duration: buffer.duration,
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
        detectedLoop: detected,
        info: {
          ...info,
          frames: buffer.length,
          duration: buffer.duration,
          loop: detected,
        },
      });
      setStart(detected?.loopStartSample ?? 0);
      setEnd(detected?.loopEndSample ?? buffer.length);
      setResult(null);
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
      resultUrl.current = null;
      setStatus("Source loaded. Existing valid loop markers are retained.");
    } catch (err) {
      if (token === generation.current)
        setError(
          abort.signal.aborted
            ? "Load cancelled."
            : err instanceof Error
              ? err.message
              : String(err),
        );
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }
  function changeBounds(a: number, b: number) {
    if (!track) return;
    try {
      assertRegion(track.audioBuffer.length, a, b);
      setStart(a);
      setEnd(b);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  function commitDraft() {
    const a = Number(draftStart),
      b = Number(draftEnd);
    if (draftStart === "" || draftEnd === "") {
      setError("Both frame values are required.");
      setDraftStart(String(start));
      setDraftEnd(String(end));
      return;
    }
    changeBounds(a, b);
    if (
      !Number.isInteger(a) ||
      !Number.isInteger(b) ||
      a < 0 ||
      b <= a ||
      b > (track?.audioBuffer.length ?? 0)
    ) {
      setDraftStart(String(start));
      setDraftEnd(String(end));
    }
  }
  function snap(which: "start" | "end" | "both") {
    if (!track) return;
    let a = start,
      b = end;
    const messages: string[] = [];
    if (which !== "end") {
      const res = findNearestZeroCrossing(
        track.audioBuffer,
        a,
        2500,
        "rising",
        0,
        b - 1,
      );
      if (res.found) a = res.sample;
      else messages.push("No nearby start crossing found.");
    }
    if (which !== "start") {
      const res = findNearestZeroCrossing(
        track.audioBuffer,
        b,
        2500,
        "rising",
        a + 1,
        track.audioBuffer.length - 1,
      );
      if (res.found) b = res.sample;
      else messages.push("No nearby end crossing found.");
    }
    changeBounds(a, b);
    setStatus(
      messages.join(" ") ||
        "Snapped to nearby channel-1 crossings. Audition the transition; snapping cannot guarantee a click-free stereo join.",
    );
  }
  async function audition() {
    if (!track || !player.current || exportLock.current) return;
    exportLock.current = true;
    setExporting(true);
    setError("");
    const abort = new AbortController();
    exportController.current = abort;
    try {
      setStatus("Preparing crossfade audition…");
      const pcm = await prepareInWorker(
        track.audioBuffer,
        start,
        end,
        crossfade,
        1,
        abort.signal,
      );
      const ctx = new OfflineAudioContext(track.channels, 1, track.sampleRate);
      const buffer = await ctx.decodeAudioData(pcm.wav);
      if (abort.signal.aborted) return;
      player.current.loadBuffer(buffer);
      player.current.setLooping(true);
      setLooping(true);
      setPrepared(true);
      await player.current.play();
      setStatus(
        "Auditioning the prepared loop. DSP and normalization remain export-only.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      exportLock.current = false;
      setExporting(false);
      exportController.current = null;
    }
  }
  function sourcePreview() {
    if (track) {
      player.current?.loadBuffer(
        track.audioBuffer,
        start / track.sampleRate,
        end / track.sampleRate,
      );
      player.current?.setLooping(looping);
      setPrepared(false);
    }
  }
  async function exportAudio() {
    if (!track || exportLock.current || loading) return;
    exportLock.current = true;
    setExporting(true);
    setError("");
    setProgress(0);
    const abort = new AbortController();
    exportController.current = abort;
    const snapshot = revision;
    try {
      let bytes: Uint8Array;
      let ext: string;
      let bounds = { loopStartSample: start, loopEndSample: end };
      if (regionOnly) {
        setStatus("Preparing loop region…");
        const pcm = await prepareInWorker(
          track.audioBuffer,
          start,
          end,
          crossfade,
          repeats,
          abort.signal,
        );
        bytes = new Uint8Array(pcm.wav);
        ext = "wav";
        bounds = { loopStartSample: 0, loopEndSample: pcm.loopFrames };
      } else {
        bytes = new Uint8Array(await track.file.arrayBuffer());
        ext = track.file.name.split(".").pop() ?? "bin";
      }
      const out = await ffmpegService.transcodeAudio(
        bytes,
        ext,
        {
          ...options,
          audioStream: regionOnly ? 0 : options.audioStream,
          dynamicRangeCompressor: compressor,
        },
        undefined,
        (p, s) => {
          setProgress(p);
          setStatus(s);
        },
        bounds,
        abort.signal,
      );
      if (abort.signal.aborted) return;
      const url = URL.createObjectURL(out.blob);
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
      resultUrl.current = url;
      setResult({
        url,
        name: `${track.name.replace(/\.[^.]+$/, "")}${regionOnly ? `_loop_${repeats}x` : "_with_loop"}.${out.fileName.split(".").pop()}`,
        revision: snapshot,
        warnings: out.warnings,
        sampleRate: out.info.sampleRate,
        channels: out.info.channels,
      });
      setStatus(
        "Export complete. You can audition/download the rendered result below.",
      );
    } catch (err) {
      setError(
        abort.signal.aborted
          ? "Export cancelled. Previous output, if present, is unchanged."
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      exportLock.current = false;
      setExporting(false);
      exportController.current = null;
    }
  }
  const fadeFrames = track
    ? Math.min(
        Math.floor((crossfade * track.sampleRate) / 1000),
        Math.floor((end - start) / 2),
      )
    : 0;
  return (
    <section className="workspace" aria-labelledby="studio-heading">
      <h2 id="studio-heading">Loop & edit studio</h2>
      <p>
        Open audio, keep trusted loop markers, and export locally. Source files
        are never changed.
      </p>
      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files[0]) void load(e.dataTransfer.files[0]);
        }}
      >
        <button disabled={exporting} onClick={() => input.current?.click()}>
          {track ? "Load different file" : "Browse audio"}
        </button>
        <p>Or drop a file here · 128 MiB input maximum · mono/stereo editing</p>
        <input
          ref={input}
          type="file"
          hidden
          tabIndex={-1}
          aria-label="Studio audio file"
          accept="audio/*,.aif,.aiff,.flac,.m4a,.opus"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void load(file);
          }}
        />
      </div>
      <p role="status" aria-live="polite">
        {status}
      </p>
      {(loading || exporting) && (
        <div className="actions">
          <progress
            value={progress}
            max={100}
            aria-label="Audio job progress"
          />
          <button
            onClick={() => {
              loadController.current?.abort();
              exportController.current?.abort();
            }}
          >
            Cancel operation
          </button>
        </div>
      )}
      {error && (
        <pre className="error" role="alert">
          {error}
        </pre>
      )}
      {track && (
        <>
          <div className="panel">
            <h3 className="filename">{track.name}</h3>
            <p>
              {track.sampleRate.toLocaleString()} Hz ·{" "}
              {track.channels === 1 ? "Mono" : `${track.channels} channels`} ·{" "}
              {track.audioBuffer.length.toLocaleString()} frames ·{" "}
              {track.duration.toFixed(6)} s
            </p>
            {track.detectedLoop && (
              <p className="success">
                Imported {track.detectedLoop.source}: frames{" "}
                {track.detectedLoop.loopStartSample}–
                {track.detectedLoop.loopEndSample} (exclusive end).
              </p>
            )}
            {track.info.warnings.map((w, i) => (
              <p className="notice" key={i}>
                {w}
              </p>
            ))}
            {track.info.streams.length > 1 && (
              <label>
                Audio track
                <select
                  disabled={exporting || loading}
                  value={options.audioStream ?? 0}
                  onChange={(e) => {
                    const audioStream = Number(e.target.value);
                    void load(track.file, audioStream);
                  }}
                >
                  {track.info.streams.map((s) => (
                    <option key={s.index} value={s.index}>
                      {s.description}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <WaveformVisualizer
            key={track.id}
            audioBuffer={track.audioBuffer}
            currentTimeSec={
              prepared
                ? start / track.sampleRate +
                  (time % ((end - start - fadeFrames) / track.sampleRate))
                : time
            }
            loopStartSec={start / track.sampleRate}
            loopEndSec={end / track.sampleRate}
            onLoopChange={(a, b) =>
              changeBounds(
                Math.round(a * track.sampleRate),
                Math.round(b * track.sampleRate),
              )
            }
            onSeek={(t) => {
              if (prepared) sourcePreview();
              player.current?.seek(t);
            }}
          />
          <div className="panel actions">
            <button
              onClick={() =>
                void player.current
                  ?.togglePlay()
                  .catch((err) => setError(String(err)))
              }
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button
              onClick={() => {
                sourcePreview();
                player.current?.seek(0);
              }}
            >
              Rewind / source preview
            </button>
            <button
              onClick={() => {
                sourcePreview();
                player.current?.seek(start / track.sampleRate);
              }}
            >
              Jump to loop start
            </button>
            <button
              aria-pressed={looping}
              onClick={() => {
                setLooping(!looping);
              }}
            >
              Loop {looping ? "on" : "off"}
            </button>
            <label>
              Monitor volume
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolume(v);
                  player.current?.setVolume(v);
                }}
              />
            </label>
            <span>
              {prepared ? "Prepared loop" : "Source"} · {time.toFixed(3)} s
            </span>
          </div>
          <fieldset disabled={loading || exporting} className="panel">
            <legend>Loop bounds (source frames, exclusive end)</legend>
            <div className="actions">
              <label>
                Loop start frame
                <input
                  type="number"
                  min={0}
                  max={end - 1}
                  step={1}
                  value={draftStart}
                  onChange={(e) => setDraftStart(e.target.value)}
                  onBlur={commitDraft}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitDraft();
                  }}
                />
              </label>
              <label>
                Loop end frame
                <input
                  type="number"
                  min={start + 1}
                  max={track.audioBuffer.length}
                  step={1}
                  value={draftEnd}
                  onChange={(e) => setDraftEnd(e.target.value)}
                  onBlur={commitDraft}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitDraft();
                  }}
                />
              </label>
              <button onClick={() => changeBounds(0, track.audioBuffer.length)}>
                Select full track
              </button>
            </div>
            <p>
              Start {(start / track.sampleRate).toFixed(6)} s · end{" "}
              {(end / track.sampleRate).toFixed(6)} s · length{" "}
              {((end - start) / track.sampleRate).toFixed(6)} s
            </p>
            <div className="actions">
              <button onClick={() => snap("start")}>Snap loop in</button>
              <button onClick={() => snap("end")}>Snap loop out</button>
              <button onClick={() => snap("both")}>Snap both</button>
              <button
                onClick={() => {
                  if (track.detectedLoop)
                    changeBounds(
                      track.detectedLoop.loopStartSample,
                      track.detectedLoop.loopEndSample,
                    );
                }}
                disabled={!track.detectedLoop}
              >
                Restore imported markers
              </button>
            </div>
            <p>
              Snapping adjusts channel-1 crossings and can change timing. It is
              optional; imported markers stay unchanged unless you edit them.
            </p>
          </fieldset>
          <fieldset disabled={loading || exporting} className="panel">
            <legend>Export content</legend>
            <label>
              Content
              <select
                value={regionOnly ? "region" : "whole"}
                onChange={(e) => setRegionOnly(e.target.value === "region")}
              >
                <option value="whole">
                  Whole track with selected loop markers (keeps intro/tail)
                </option>
                <option value="region">Loop region only</option>
              </select>
            </label>
            {regionOnly && (
              <>
                <label>
                  Overlap crossfade (ms)
                  <input
                    type="range"
                    min={0}
                    max={250}
                    step={1}
                    value={crossfade}
                    onChange={(e) => setCrossfade(Number(e.target.value))}
                  />
                  {crossfade} ms
                </label>
                <label>
                  Repeats
                  <select
                    value={repeats}
                    onChange={(e) => setRepeats(Number(e.target.value))}
                  >
                    {[1, 2, 4, 8].map((n) => (
                      <option key={n} value={n}>
                        {n}×
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  Overlap shortens each loop by {fadeFrames} frames. Export
                  length:{" "}
                  {(
                    ((end - start - fadeFrames) * repeats) /
                    track.sampleRate
                  ).toFixed(6)}{" "}
                  s. Embedded markers cover one repetition.
                </p>
                <button onClick={() => void audition()}>
                  Audition loop / crossfade
                </button>
              </>
            )}
          </fieldset>
          <fieldset disabled={loading || exporting} className="panel">
            <legend>Dynamic range compressor (export only)</legend>
            <label className="check">
              <input
                type="checkbox"
                checked={compressor.enabled}
                onChange={(e) =>
                  setCompressor((v) => ({ ...v, enabled: e.target.checked }))
                }
              />
              Enable compressor
            </label>
            {compressor.enabled && (
              <div className="actions">
                {(
                  [
                    ["Gentle master", -16, 2.5, 25, 200, 1.5],
                    ["Punchy beats", -14, 5, 40, 100, 2.5],
                    ["Voice clarity", -20, 4, 15, 150, 3],
                    ["Fast peaks", -3, 16, 5, 50, 0],
                  ] as const
                ).map(
                  ([
                    name,
                    thresholdDb,
                    ratio,
                    attackMs,
                    releaseMs,
                    makeupGainDb,
                  ]) => (
                    <button
                      key={name}
                      onClick={() =>
                        setCompressor({
                          enabled: true,
                          thresholdDb,
                          ratio,
                          attackMs,
                          releaseMs,
                          makeupGainDb,
                        })
                      }
                    >
                      {name}
                    </button>
                  ),
                )}
              </div>
            )}
            {compressor.enabled && (
              <div className="control-grid">
                {(
                  [
                    {
                      key: "thresholdDb",
                      label: "Threshold (dB)",
                      min: -40,
                      max: 0,
                      step: 1,
                    },
                    {
                      key: "ratio",
                      label: "Ratio",
                      min: 1,
                      max: 20,
                      step: 0.5,
                    },
                    {
                      key: "attackMs",
                      label: "Attack (ms)",
                      min: 1,
                      max: 100,
                      step: 1,
                    },
                    {
                      key: "releaseMs",
                      label: "Release (ms)",
                      min: 10,
                      max: 1000,
                      step: 10,
                    },
                    {
                      key: "makeupGainDb",
                      label: "Makeup gain (dB)",
                      min: 0,
                      max: 12,
                      step: 0.5,
                    },
                  ] as const
                ).map((c) => (
                  <label key={c.key}>
                    {c.label}: {compressor[c.key]}
                    <input
                      type="range"
                      min={c.min}
                      max={c.max}
                      step={c.step}
                      value={compressor[c.key]}
                      onChange={(e) =>
                        setCompressor((v) => ({
                          ...v,
                          [c.key]: Number(e.target.value),
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            )}
            <p>
              Listen to the rendered output below to check DSP/normalization.
              They do not change source playback.
            </p>
          </fieldset>
          <ExportSettings
            value={options}
            onChange={setOptions}
            disabled={loading || exporting}
          />
          <button
            disabled={loading || exporting}
            onClick={() => void exportAudio()}
          >
            Export & convert audio
          </button>
          {result && (
            <div className="panel">
              <h3>
                {result.revision === revision
                  ? "Rendered output ready"
                  : "Previous rendered output — settings have changed"}
              </h3>
              <p className="filename">{result.name}</p>
              <p>
                {result.sampleRate} Hz · {result.channels} channel(s)
              </p>
              {result.warnings.map((w, i) => (
                <p className="notice" key={i}>
                  {w}
                </p>
              ))}
              <a className="button" href={result.url} download={result.name}>
                Download rendered file
              </a>
              {options.format !== "raw_pcm" && (
                <>
                  <audio
                    controls
                    src={result.url}
                    aria-label="Rendered output preview"
                  />
                  <p>
                    Browser playback support varies by format. The download
                    remains available if this player cannot decode it.
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
