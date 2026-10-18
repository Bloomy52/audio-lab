import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import type { AudioExportOptions, BatchQueueItem } from "../types/audio";
import { ffmpegService } from "../services/ffmpegService";
import {
  checkInputSize,
  defaultOptions,
  outputExtension,
  uniqueName,
} from "../utils/exportOptions";
import { ExportSettings } from "./ExportSettings";
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function BatchConverter() {
  const [queue, setQueue] = useState<BatchQueueItem[]>([]);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const [options, setOptions] = useState<AudioExportOptions>(() => ({
    ...defaultOptions(),
    format: "mp3",
    compressionMode: "lossy_cbr",
  }));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [zipBusy, setZipBusy] = useState(false);
  const zipRef = useRef(false);
  const [zipProgress, setZipProgress] = useState(0);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  const update = (id: string, part: Partial<BatchQueueItem>) =>
    setQueue((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...part } : it)),
    );
  function add(files: FileList | File[]) {
    if (busyRef.current) return;
    try {
      const items = Array.from(files);
      items.forEach((f) => checkInputSize(f.size));
      if (queueRef.current.length + items.length > 50)
        throw new Error("Use batches of at most 50 files.");
      if (
        [...queueRef.current.map((q) => q.file), ...items].reduce(
          (n, f) => n + f.size,
          0,
        ) >
        192 * 1024 * 1024
      )
        throw new Error("Keep total queued input below 192 MiB.");
      setQueue((prev) => [
        ...prev,
        ...items.map((file) => ({
          id: crypto.randomUUID(),
          file,
          name: file.name,
          sizeBytes: file.size,
          status: "pending" as const,
          progress: 0,
          options: { ...options },
        })),
      ]);
      setError("");
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  }
  async function inspectTracks(item: BatchQueueItem) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const info = await ffmpegService.inspectAudio(
        new Uint8Array(await item.file.arrayBuffer()),
        item.name.split(".").pop() ?? "bin",
        0,
        abort.signal,
      );
      update(item.id, {
        streams: info.streams,
        errorMessage: undefined,
        warnings: info.warnings,
      });
    } catch (err) {
      update(item.id, {
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
      controller.current = null;
    }
  }
  async function process() {
    if (busyRef.current) return;
    const jobs = queueRef.current.filter((it) => it.status !== "completed");
    if (!jobs.length) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const abort = new AbortController();
    controller.current = abort;
    const used = new Set(
      queueRef.current
        .filter((it) => it.status === "completed")
        .map((it) => it.outputFileName!.toLocaleLowerCase()),
    );
    let retained = queueRef.current.reduce(
      (n, it) => n + (it.outputSizeBytes ?? 0),
      0,
    );
    try {
      for (const item of jobs) {
        if (abort.signal.aborted) break;
        const applied = {
          ...structuredClone(options),
          audioStream: item.options.audioStream ?? 0,
        };
        update(item.id, {
          status: "processing",
          progress: 0,
          options: applied,
          errorMessage: undefined,
        });
        try {
          const result = await ffmpegService.transcodeAudio(
            new Uint8Array(await item.file.arrayBuffer()),
            item.name.split(".").pop() ?? "bin",
            applied,
            undefined,
            (progress) => update(item.id, { progress }),
            undefined,
            abort.signal,
          );
          if (abort.signal.aborted)
            throw new DOMException("Cancelled", "AbortError");
          if (retained + result.blob.size > 192 * 1024 * 1024)
            throw new Error(
              "Completed outputs would exceed 192 MiB. Download and clear completed files, then retry.",
            );
          retained += result.blob.size;
          const outputFileName = uniqueName(
            `${item.name.replace(/\.[^.]+$/, "")}.${outputExtension(applied.format)}`,
            used,
          );
          const warnings = [
            ...result.warnings,
            `Output: ${result.info.sampleRate} Hz, ${result.info.channels} channel(s)${applied.format === "raw_pcm" ? ", signed 16-bit little-endian PCM" : ""}.`,
          ];
          update(item.id, {
            status: "completed",
            progress: 100,
            outputBlob: result.blob,
            outputSizeBytes: result.blob.size,
            outputFileName,
            warnings,
          });
        } catch (err) {
          update(item.id, {
            status: abort.signal.aborted ? "cancelled" : "error",
            progress: 0,
            errorMessage: err instanceof Error ? err.message : String(err),
          });
          if (abort.signal.aborted) break;
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      controller.current = null;
    }
  }
  async function zipAll() {
    if (zipRef.current) return;
    zipRef.current = true;
    setZipBusy(true);
    setZipProgress(0);
    setError("");
    try {
      const items = queueRef.current.filter(
        (it) => it.status === "completed" && it.outputBlob,
      );
      const zip = new JSZip();
      const used = new Set<string>();
      for (const item of items)
        zip.file(uniqueName(item.outputFileName!, used), item.outputBlob!);
      if (Object.keys(zip.files).length !== items.length)
        throw new Error("Archive verification failed.");
      const blob = await zip.generateAsync({ type: "blob" }, (meta) =>
        setZipProgress(Math.round(meta.percent)),
      );
      saveBlob(blob, "AudioLab_Batch.zip");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setZipBusy(false);
      zipRef.current = false;
    }
  }
  const completed = queue.filter((it) => it.status === "completed");
  return (
    <section className="workspace" aria-labelledby="batch-heading">
      <h2 id="batch-heading">Batch converter</h2>
      <p>
        Files stay in this browser. A batch uses the settings below; adding
        files is paused while it runs.
      </p>
      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          add(e.dataTransfer.files);
        }}
      >
        <button disabled={busy} onClick={() => input.current?.click()}>
          Select audio or video files
        </button>
        <p>
          Or drop files here · 128 MiB per file · 192 MiB total input · 50 files
          maximum
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept="audio/*,video/*,.aif,.aiff,.flac,.m4a,.mkv,.opus"
          hidden
          tabIndex={-1}
          aria-label="Batch audio files"
          disabled={busy}
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <ExportSettings value={options} onChange={setOptions} disabled={busy} />
      <div className="actions">
        <button
          disabled={busy || !queue.some((it) => it.status !== "completed")}
          onClick={() => void process()}
        >
          Convert pending / retry failed
        </button>
        {busy && (
          <button onClick={() => controller.current?.abort()}>
            Cancel batch
          </button>
        )}
        <button
          disabled={busy || zipBusy || !completed.length}
          onClick={() => void zipAll()}
        >
          {zipBusy
            ? `Building ZIP ${zipProgress}%`
            : "Download completed as ZIP"}
        </button>
        <button
          disabled={busy || zipBusy || !completed.length}
          onClick={() =>
            setQueue((prev) => prev.filter((it) => it.status !== "completed"))
          }
        >
          Clear completed
        </button>
        <button
          disabled={busy || zipBusy || !queue.length}
          onClick={() => setQueue([])}
        >
          Clear queue
        </button>
      </div>
      {completed.length > 0 && (
        <p>
          To reconvert completed items with new settings, download them first,
          then remove/re-add their source files.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p role="status" aria-live="polite">
        {busy
          ? "Processing batch…"
          : `${completed.length} of ${queue.length} files complete`}
      </p>
      <ul className="queue">
        {queue.map((item) => (
          <li key={item.id} className="panel">
            <div className="row">
              <strong className="filename">{item.name}</strong>
              <span>
                {(item.sizeBytes / 1e6).toFixed(2)} MB →{" "}
                {(item.status === "completed" || item.status === "processing"
                  ? item.options.format
                  : options.format
                ).toUpperCase()}{" "}
                · {item.status}
              </span>
            </div>
            {item.status === "processing" && (
              <progress
                max={100}
                value={item.progress}
                aria-label={`Conversion progress for ${item.name}`}
              />
            )}
            <p>
              {item.outputFileName}
              {item.outputSizeBytes !== undefined &&
                ` · ${(item.outputSizeBytes / 1e6).toFixed(2)} MB`}
            </p>
            {item.status !== "completed" && (
              <div className="actions">
                {item.streams ? (
                  <label>
                    Audio track for {item.name}
                    <select
                      disabled={busy}
                      value={item.options.audioStream ?? 0}
                      onChange={(e) =>
                        update(item.id, {
                          options: {
                            ...item.options,
                            audioStream: Number(e.target.value),
                          },
                        })
                      }
                    >
                      {item.streams.map((stream) => (
                        <option key={stream.index} value={stream.index}>
                          {stream.description}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() => void inspectTracks(item)}
                  >
                    Inspect audio tracks
                  </button>
                )}
                <span>
                  Selected audio track: {(item.options.audioStream ?? 0) + 1}{" "}
                  (first by default)
                </span>
              </div>
            )}
            {item.outputBlob && (
              <button
                onClick={() => saveBlob(item.outputBlob!, item.outputFileName!)}
              >
                Download {item.outputFileName}
              </button>
            )}
            {item.errorMessage && (
              <pre role="alert" className="error">
                {item.errorMessage}
              </pre>
            )}
            {item.warnings?.map((w, i) => (
              <p className="notice" key={i}>
                {w}
              </p>
            ))}
            <button
              disabled={busy || zipBusy}
              onClick={() =>
                setQueue((prev) => prev.filter((it) => it.id !== item.id))
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
