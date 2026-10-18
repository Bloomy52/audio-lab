import { useEffect, useMemo, useRef, useState } from "react";
interface Props {
  audioBuffer: AudioBuffer | null;
  currentTimeSec: number;
  loopStartSec: number;
  loopEndSec: number;
  onLoopChange: (a: number, b: number) => void;
  onSeek: (time: number) => void;
}
interface Envelope {
  min: Float32Array;
  max: Float32Array;
  step: number;
}
function envelopes(data: Float32Array) {
  const levels: Envelope[] = [];
  let step = 64;
  let min = new Float32Array(Math.ceil(data.length / step)),
    max = new Float32Array(min.length);
  for (let b = 0; b < min.length; b++) {
    let lo = Infinity,
      hi = -Infinity;
    for (let i = b * step; i < Math.min((b + 1) * step, data.length); i++) {
      lo = Math.min(lo, data[i]);
      hi = Math.max(hi, data[i]);
    }
    min[b] = lo;
    max[b] = hi;
  }
  levels.push({ min, max, step });
  while (min.length > 1) {
    const a = new Float32Array(Math.ceil(min.length / 2)),
      b = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) {
      a[i] = Math.min(min[i * 2], min[i * 2 + 1] ?? min[i * 2]);
      b[i] = Math.max(max[i * 2], max[i * 2 + 1] ?? max[i * 2]);
    }
    min = a;
    max = b;
    step *= 2;
    levels.push({ min, max, step });
  }
  return levels;
}
export function WaveformVisualizer({
  audioBuffer: buffer,
  currentTimeSec,
  loopStartSec,
  loopEndSec,
  onLoopChange,
  onSeek,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState({ width: 800, height: 240, dpr: 1 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  const drag = useRef<{
    pointer: number;
    mode: "start" | "end" | "region" | "seek";
    x: number;
    start: number;
    end: number;
  } | null>(null);
  const cache = useMemo(
    () =>
      buffer
        ? Array.from({ length: buffer.numberOfChannels }, (_, ch) =>
            envelopes(buffer.getChannelData(ch)),
          )
        : [],
    [buffer],
  );
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0)
        setViewport({
          width: r.width,
          height: r.height,
          dpr: window.devicePixelRatio || 1,
        });
    };
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      obs.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const duration = buffer?.duration ?? 1;
  const visible = duration / zoom;
  const origin = pan * (duration - visible);
  const xTime = (x: number) =>
    Math.max(
      0,
      Math.min(
        duration,
        origin +
          (Math.max(0, Math.min(viewport.width, x)) / viewport.width) * visible,
      ),
    );
  const tx = (t: number) => ((t - origin) / visible) * viewport.width;
  useEffect(() => {
    const el = canvas.current;
    if (!el || !buffer) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const { width: w, height: h, dpr } = viewport;
    const pw = Math.round(w * dpr),
      ph = Math.round(h * dpr);
    if (el.width !== pw || el.height !== ph) {
      el.width = pw;
      el.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#080e1b";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i <= 5; i++) {
      const x = (i * w) / 5;
      ctx.strokeStyle = "#26324b";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillStyle = "#a9b6ce";
      ctx.font = "11px monospace";
      ctx.fillText(
        `${(origin + (visible * i) / 5).toFixed(zoom > 8 ? 4 : 2)}s`,
        Math.min(x + 3, w - 80),
        14,
      );
    }
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const top = 24 + (ch * (h - 24)) / buffer.numberOfChannels;
      const height = (h - 24) / buffer.numberOfChannels;
      const mid = top + height / 2;
      const data = buffer.getChannelData(ch);
      const perPixel = (visible * buffer.sampleRate) / w;
      const level = cache[ch].filter((l) => l.step <= perPixel).at(-1);
      ctx.strokeStyle = ch === 0 ? "#2dd4bf" : "#38bdf8";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const first = Math.max(
          0,
          Math.floor((origin + (x / w) * visible) * buffer.sampleRate),
        );
        const last = Math.min(
          buffer.length,
          Math.max(
            first + 1,
            Math.ceil((origin + ((x + 1) / w) * visible) * buffer.sampleRate),
          ),
        );
        let min = 1,
          max = -1;
        if (level) {
          for (
            let b = Math.floor(first / level.step);
            b <=
            Math.min(level.min.length - 1, Math.floor((last - 1) / level.step));
            b++
          ) {
            min = Math.min(min, level.min[b]);
            max = Math.max(max, level.max[b]);
          }
        } else {
          for (let i = first; i < last; i++) {
            min = Math.min(min, data[i]);
            max = Math.max(max, data[i]);
          }
        }
        if (min <= max) {
          ctx.moveTo(x, mid - max * height * 0.42);
          ctx.lineTo(x, mid - min * height * 0.42 + 0.5);
        }
      }
      ctx.stroke();
      ctx.fillStyle = "#d9e2f4";
      ctx.fillText(
        buffer.numberOfChannels === 1 ? "Mono" : `Channel ${ch + 1}`,
        8,
        top + 12,
      );
    }
    const a = tx(loopStartSec),
      b = tx(loopEndSec);
    ctx.fillStyle = "rgba(3,7,18,.60)";
    ctx.fillRect(0, 24, Math.max(0, a), h);
    ctx.fillRect(Math.max(0, b), 24, w - Math.max(0, b), h);
    for (const [x, color, label] of [
      [a, "#34d399", "IN"],
      [b, "#22d3ee", "OUT"],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillRect(x - 8, 20, 16, 18);
      ctx.fillText(label, Math.max(0, Math.min(w - 25, x + 5)), h - 8);
    }
    ctx.strokeStyle = "#fb7185";
    const pos = tx(currentTimeSec);
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, h);
    ctx.stroke();
  }, [
    buffer,
    cache,
    viewport,
    zoom,
    pan,
    currentTimeSec,
    loopStartSec,
    loopEndSec,
  ]);
  return (
    <div className="waveform">
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Audio waveform for all ${buffer?.numberOfChannels ?? 0} channels. Loop ${loopStartSec.toFixed(6)} to ${loopEndSec.toFixed(6)} seconds. Edit exact bounds using the frame inputs below.`}
        style={{ width: "100%", height: 280, touchAction: "none" }}
        onPointerDown={(e) => {
          if (!buffer || e.button !== 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const a = tx(loopStartSec),
            b = tx(loopEndSec);
          const tolerance = e.pointerType === "touch" ? 24 : 12;
          let mode: "start" | "end" | "region" | "seek" = "seek";
          if (Math.min(Math.abs(x - a), Math.abs(x - b)) <= tolerance)
            mode = Math.abs(x - a) <= Math.abs(x - b) ? "start" : "end";
          else if (e.shiftKey && x > a && x < b) mode = "region";
          drag.current = {
            pointer: e.pointerId,
            mode,
            x,
            start: loopStartSec,
            end: loopEndSec,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
          if (mode === "seek") onSeek(xTime(x));
        }}
        onPointerMove={(e) => {
          if (!buffer || drag.current?.pointer !== e.pointerId) return;
          const d = drag.current;
          const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
          const t = xTime(x);
          const frame = 1 / buffer.sampleRate;
          if (d.mode === "start")
            onLoopChange(
              Math.max(0, Math.min(loopEndSec - frame, t)),
              loopEndSec,
            );
          if (d.mode === "end")
            onLoopChange(
              loopStartSec,
              Math.min(duration, Math.max(loopStartSec + frame, t)),
            );
          if (d.mode === "seek") onSeek(t);
          if (d.mode === "region") {
            const len = d.end - d.start;
            const delta = ((x - d.x) / viewport.width) * visible;
            const a = Math.max(0, Math.min(duration - len, d.start + delta));
            onLoopChange(a, a + len);
          }
        }}
        onPointerUp={(e) => {
          drag.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      />
      <p>
        Drag IN/OUT handles with a mouse or touch · click to seek · Shift-drag
        to move the region · exact frame inputs below
      </p>
      <div className="actions">
        <button
          onClick={() => setZoom((v) => Math.max(1, v / 2))}
          aria-label="Zoom out waveform"
        >
          −
        </button>
        <span>{zoom.toFixed(1)}×</span>
        <button
          onClick={() =>
            setZoom((v) =>
              Math.min(
                Math.max(32, ((buffer?.length ?? 1) / viewport.width) * 8),
                v * 2,
              ),
            )
          }
          aria-label="Zoom in waveform"
        >
          +
        </button>
        <button
          onClick={() => {
            setZoom(1);
            setPan(0);
          }}
        >
          Fit waveform
        </button>
      </div>
      {zoom > 1 && (
        <label>
          Pan waveform
          <input
            type="range"
            min={0}
            max={1}
            step="any"
            value={pan}
            onChange={(e) => setPan(Number(e.target.value))}
          />
        </label>
      )}
    </div>
  );
}
