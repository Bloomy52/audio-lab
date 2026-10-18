import { useId } from "react";
import type {
  AudioExportOptions,
  AudioFormat,
  CompressionMode,
} from "../types/audio";
import {
  FORMATS,
  modesFor,
  ratesFor,
  canEmbedLoop,
} from "../utils/exportOptions";
const names: Record<CompressionMode, string> = {
  uncompressed: "Lossless / PCM",
  flac_level: "FLAC compression level",
  adpcm: "ADPCM",
  lossy_cbr: "Bitrate",
  lossy_vbr: "Variable bitrate",
  target_size: "Fit within file size",
};
export function ExportSettings({
  value: o,
  onChange,
  disabled = false,
}: {
  value: AudioExportOptions;
  onChange: (o: AudioExportOptions) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const update = (part: Partial<AudioExportOptions>) =>
    onChange({ ...o, ...part });
  return (
    <fieldset disabled={disabled} className="settings">
      <legend>Output settings</legend>
      <label htmlFor={`${id}-format`}>Format</label>
      <select
        id={`${id}-format`}
        value={o.format}
        onChange={(e) => {
          const format = e.target.value as AudioFormat;
          update({
            format,
            compressionMode: modesFor(format)[0],
            sampleRate: undefined,
            bitDepth:
              !["wav", "aiff"].includes(format) && o.bitDepth === 32
                ? 24
                : o.bitDepth,
            vbrQuality: format === "ogg" ? 5 : 2,
          });
        }}
      >
        {FORMATS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-mode`}>Compression</label>
      <select
        id={`${id}-mode`}
        value={o.compressionMode}
        onChange={(e) =>
          update({ compressionMode: e.target.value as CompressionMode })
        }
      >
        {modesFor(o.format).map((m) => (
          <option key={m} value={m}>
            {names[m]}
          </option>
        ))}
      </select>
      {(o.compressionMode === "lossy_cbr" ||
        o.compressionMode === "target_size" ||
        (o.compressionMode === "lossy_vbr" &&
          ["opus", "webm"].includes(o.format))) && (
        <>
          <label htmlFor={`${id}-amount`}>
            {o.compressionMode === "target_size"
              ? "Maximum size (decimal MB)"
              : "Bitrate (kbps)"}
          </label>
          <input
            id={`${id}-amount`}
            type="number"
            min={o.compressionMode === "target_size" ? 0.1 : 16}
            max={o.compressionMode === "target_size" ? 250 : 320}
            step={o.compressionMode === "target_size" ? 0.1 : 1}
            value={
              o.compressionMode === "target_size"
                ? o.targetSizeMb
                : o.bitrateKbps
            }
            onChange={(e) =>
              update(
                o.compressionMode === "target_size"
                  ? { targetSizeMb: Number(e.target.value) }
                  : { bitrateKbps: Number(e.target.value) },
              )
            }
          />
        </>
      )}
      {o.compressionMode === "lossy_vbr" &&
        ["mp3", "ogg"].includes(o.format) && (
          <>
            <label htmlFor={`${id}-quality`}>
              Quality (
              {o.format === "mp3"
                ? "0 best, 9 smallest"
                : "0 smallest, 10 best"}
              )
            </label>
            <input
              id={`${id}-quality`}
              type="number"
              min={0}
              max={o.format === "mp3" ? 9 : 10}
              value={o.vbrQuality ?? 2}
              onChange={(e) => update({ vbrQuality: Number(e.target.value) })}
            />
          </>
        )}
      {o.compressionMode === "flac_level" && (
        <>
          <label htmlFor={`${id}-flac`}>FLAC level (0 fast – 8 smallest)</label>
          <input
            id={`${id}-flac`}
            type="number"
            min={0}
            max={8}
            value={o.flacCompressionLevel ?? 5}
            onChange={(e) =>
              update({ flacCompressionLevel: Number(e.target.value) })
            }
          />
        </>
      )}
      {o.compressionMode === "adpcm" && (
        <>
          <label htmlFor={`${id}-adpcm`}>ADPCM codec</label>
          <select
            id={`${id}-adpcm`}
            value={o.adpcmType}
            onChange={(e) =>
              update({
                adpcmType: e.target.value as AudioExportOptions["adpcmType"],
              })
            }
          >
            <option value="ima_wav">IMA WAV</option>
            <option value="ms">Microsoft</option>
            <option value="yamaha">Yamaha</option>
          </select>
        </>
      )}
      {["wav", "aiff", "flac", "alac"].includes(o.format) &&
        o.compressionMode !== "adpcm" && (
          <>
            <label htmlFor={`${id}-depth`}>Output bit depth</label>
            <select
              id={`${id}-depth`}
              value={o.bitDepth ?? 16}
              onChange={(e) =>
                update({ bitDepth: Number(e.target.value) as 16 | 24 | 32 })
              }
            >
              <option value={16}>16-bit</option>
              <option value={24}>24-bit</option>
              {["wav", "aiff"].includes(o.format) && (
                <option value={32}>32-bit integer</option>
              )}
            </select>
          </>
        )}
      <label htmlFor={`${id}-rate`}>Sample rate</label>
      <select
        id={`${id}-rate`}
        value={o.sampleRate ?? ""}
        onChange={(e) =>
          update({
            sampleRate: e.target.value ? Number(e.target.value) : undefined,
          })
        }
      >
        <option value="">Source rate (nearest supported if needed)</option>
        {ratesFor(o.format).map((r) => (
          <option key={r} value={r}>
            {r.toLocaleString()} Hz
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-channels`}>Channels</label>
      <select
        id={`${id}-channels`}
        value={o.channels ?? ""}
        onChange={(e) =>
          update({
            channels: e.target.value
              ? (Number(e.target.value) as 1 | 2)
              : undefined,
          })
        }
      >
        <option value="">Keep source (mono/stereo)</option>
        <option value="1">Mono</option>
        <option value="2">Stereo</option>
      </select>
      <label className="check">
        <input
          type="checkbox"
          checked={!!o.normalizeLufs}
          onChange={(e) => update({ normalizeLufs: e.target.checked })}
        />
        Normalize loudness toward −16 LUFS (export only)
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={!!o.embedLoopMetadata}
          onChange={(e) => update({ embedLoopMetadata: e.target.checked })}
        />
        Preserve/embed loop markers
      </label>
      {!canEmbedLoop(o.format) && o.embedLoopMetadata && (
        <p className="notice">
          This format cannot carry Audio Lab loop markers. Choose WAV, AIFF,
          FLAC, Ogg, or Opus to retain them.
        </p>
      )}
      {o.format === "raw_pcm" && (
        <p className="notice">
          Headerless signed 16-bit little-endian PCM. Note the output rate and
          channels shown with your result when importing it elsewhere.
        </p>
      )}
    </fieldset>
  );
}
