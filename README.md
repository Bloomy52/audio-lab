# Audio Lab
A local browser audio converter and loop editor.

## How To Use Audio Lab

1. **Open Audio Lab** in your browser. You can use either of the two options below.
2. **Choose a tool:** Batch Converter to convert files, or Loop & Edit Studio to edit a loop.
3. **Add your audio** by dragging it in or choosing a file.
4. **Make your changes:** choose an output format, or set the loop’s start and end.
5. **Preview the audio** to check how it sounds.
6. **Convert or export**, then download your finished files.

Make sure to save your downloads before closing or refreshing the page.

## Accessing Audio Lab
As mentioned earlier, there are two ways you can access Audio Lab. You can either use the 
GitHub Pages version or you can use the Local Edition. Instructions for both options are below.

### GitHub Pages (Recommended)
The GitHub Pages version of Audio Lab can be found at [https://bloomy52.github.io/audio-lab](https://bloomy52.github.io/audio-lab).
This version does not require any installation and can be accessed directly from your browser.

### Local Edition
You can download the local edition of Audio Lab from [GitHub Releases](https://github.com/bloomy52/audio-lab/releases/latest).
Once installed, extract the folder and run `npm install` followed by `npm start` in the terminal. 
This will open Audio Lab in your default browser.
You can find more information for using the Local Edition in the [START-HERE.md](local/START-HERE.md) file.

## Editing and output behavior

- Studio preserves the source sample rate during native decoding, with an FFmpeg PCM fallback for formats the browser cannot decode. Audio tracks in multi-stream files can be selected. Editing supports mono/stereo; multichannel inputs must be downmixed in Batch first.
- Whole-track export keeps the intro/tail and writes the selected loop markers. Loop-region export crops the selection and can repeat it 1/2/4/8 times.
- Crossfade defaults to **off**, so trusted markers and loop timing are not changed automatically. Optional linear overlap crossfade is bounded to half the selection and shortens each repetition by the displayed overlap. Audition the prepared loop before exporting. It does not promise to eliminate every possible click.
- Zero-crossing snap is optional, stays within valid bounds, and reports when no crossing was found. A channel-1 crossing does not guarantee matching stereo phase.
- Compressor and loudness normalization are **export-only**. They retain the selected output sample rate and include a final peak limiter. Listen to the rendered output to hear their effect. Single-pass loudness normalization targets −16 LUFS; source duration/content can prevent an exact integrated loudness result.
- Region processing uses a worker and floating-point intermediates. Explicit 16/24/32-bit integer PCM output is available for WAV/AIFF. FLAC/ALAC use 16 or 24 bits. No “bit-perfect” claim is made for processing, resampling, downmixing, or bit-depth reduction. Whole-track unprocessed 16-bit lossless conversions were independently checked for identical PCM.
- Supported outputs: WAV, AIFF, FLAC, ALAC/M4A, MP3, Ogg Vorbis, Opus, AAC/M4A, AAC/ADTS, WebM Audio, WMA, AC3, and signed 16-bit little-endian raw PCM. AMR is not available in the engine build. Raw output requires recording the displayed sample rate/channels for re-import.
- Only verified mode/rate combinations are offered. An incompatible source rate is explicitly resampled with a result notice. Opus/WebM use explicit 10 ms frames because default 20 ms stereo encoding crashes the pinned engine in regression tests. All outputs explicitly exclude image/video, subtitle, and data streams, including album artwork.
- Loop metadata is supported for WAV `smpl`, AIFF MARK/INST, FLAC comments, Vorbis comments, and Opus comments. Coordinates are scaled after resampling. Unsupported loop types or malformed metadata are reported; multiple/release/reverse/ping-pong/finite loops are not faithfully preserved. Non-loop descriptive metadata and artwork are not copied to outputs.
- Size mode uses actual probed duration and **decimal MB**, validates final file bytes, and retries within bounds. An impossible budget fails clearly instead of silently returning an oversized file. Codec bitrate constraints may require choosing another format or larger budget.

## Resource and session limits

128 MiB input per file; 192 MiB queued batch input and retained outputs; at most 50 batch entries. Studio checks a 192 MiB working-PCM allocation budget, including repeat preparation. These conservative limits reduce browser crashes but do not guarantee enough memory on every device. ZIP generation is limited by the retained output budget and cannot be cancelled once JSZip starts; errors and progress are shown.

Workspaces remain mounted when switching tabs; background jobs are serialized and can be cancelled. A hidden studio pauses audio playback. Refreshing/closing the page clears the session, so download results first. The app does not persist private audio in browser storage. Completed batch files retain their applied settings and unique filenames; remove/re-add sources to reconvert them.

Source preview and rendered output have separate players. Browser playback support depends on the output codec; a valid download may be unsupported by the browser audio element.