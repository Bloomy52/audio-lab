# Audio Lab

A browser-based audio converter and loop editor. Files are processed locally with FFmpeg compiled to WebAssembly and are never uploaded.

**[Open Audio Lab](https://bloomy52.github.io/audio-lab)** · [Download the Local Edition](https://github.com/bloomy52/audio-lab/releases/latest)

## Features

- **Batch converter:** convert up to 50 audio or video files at once, then download the results individually or as a ZIP.
- **Loop & edit studio:** set loop points on a zoomable waveform, audition the loop, and export with the markers embedded.
- **Loop marker support:** reads and writes loop points for WAV, AIFF, FLAC, Ogg Vorbis, and Opus.
- **Export tools:** optional dynamic range compressor, loudness normalization toward −16 LUFS, and a final peak limiter.
- **Wide format support:** WAV, AIFF, FLAC, ALAC, MP3, Ogg Vorbis, Opus, AAC (M4A and ADTS), WebM Audio, WMA, AC3, and raw PCM.
- **Private by design:** nothing leaves your device, and nothing is stored between sessions.

## Getting started

### Hosted version (recommended)

Visit [bloomy52.github.io/audio-lab](https://bloomy52.github.io/audio-lab). No installation is required.

### Local Edition

The Local Edition runs the same app from a small server on your own machine. It requires [Node.js](https://nodejs.org/) 24 or newer.

1. Download the latest ZIP from [GitHub Releases](https://github.com/bloomy52/audio-lab/releases/latest) and extract it.
2. In the extracted folder, run `npm install`, then `npm start`.

Audio Lab opens in your default browser. See [`local/START-HERE.md`](local/START-HERE.md) for detailed, step-by-step instructions.

## Usage

1. Choose a workspace: **Batch converter** or **Loop & edit studio**.
2. Add audio by dragging a file in or browsing for one.
3. Pick an output format and settings, or set the loop start and end.
4. Preview the result.
5. Export and download your files.

> Your session is cleared when you refresh or close the page. Download your results first.

## Behavior notes

### Loop editing

- Loop end frames are **exclusive** everywhere in the interface.
- Imported loop markers are kept exactly as authored. They are never snapped or crossfaded automatically.
- Zero-crossing snap is optional and works on channel 1 only, so it cannot guarantee a click-free stereo join.
- Whole-track export keeps the intro and tail and writes your loop markers. Region export crops to the selection and can repeat it 1, 2, 4, or 8 times.
- Overlap crossfade is off by default. When enabled, each repetition is shortened by the overlap length. Audition the loop before exporting.
- Editing supports mono and stereo. Downmix multichannel files in the Batch converter first.

### Export

- The compressor and loudness normalization apply to exports only. Listen to the rendered file to hear their effect.
- Single-pass normalization targets −16 LUFS. Short or unusual material may not land exactly on target.
- Processing and resampling are not bit-perfect, so no such claim is made for them.
- Output contains audio only. Artwork, video, subtitle, and data streams are excluded.
- Descriptive metadata is not copied to outputs. Loop markers are preserved where the format supports them, and positions are rescaled after resampling.
- Only one loop is preserved. Reverse, ping-pong, finite, and release loops are reported and ignored.
- Raw PCM export is headerless signed 16-bit little-endian. Note the sample rate and channel count shown with the result when importing it elsewhere.
- AMR export is not available in the bundled FFmpeg build.
- File-size mode targets decimal megabytes and checks the actual output size. If the budget can't be met, it fails with an explanation instead of returning an oversized file.

### Limits

| Limit | Value |
| --- | --- |
| Input file size | 128 MiB |
| Batch queue | 50 files, 192 MiB total input |
| Retained batch output | 192 MiB |
| Studio working memory | 192 MiB of PCM, including repeats |

These limits reduce the risk of browser crashes but can't guarantee enough memory on every device. Jobs run one at a time and can be cancelled, except ZIP creation, which cannot be cancelled once it starts.

Browser playback depends on the codec. An exported file can be valid even if the in-page player can't play it.

## License

Add your license here. The bundled FFmpeg core (`@ffmpeg/core`) is GPL-2.0-or-later, which affects how you can distribute builds that include it.