# Audio Lab code review

Reviewed October 17, 2026. This report contains 53 actionable bugs or user-facing oversights. Application source was not changed. Running the production build regenerated `dist/`.

The app builds, and ordinary conversions can work. However, several advertised features currently produce incorrect results, silently lose work, or offer settings that cannot work. I would fix the data-loss and audio-correctness findings before calling this ready for general use.

Severity uses your 1–10 scale: 1–2 means obscure/minor; 3–4 means a limited nuisance or maintenance weakness; 5–6 means meaningful functionality, compatibility, or quality problems; 7–8 means serious loss of work, misleading output, or a broken core workflow. Nothing I found warrants 9–10. The original source files are not modified by these workflows.

“Reproduced” means a small executable reproduction demonstrated the behavior. Other findings are established by tracing source, with conditional outcomes described as such. A clean build is not evidence that these audio operations are correct.

## Verification and limits

- Read all application components, utilities, the service, types, configuration, service worker, and README. No application test suite or deployment workflow was present.
- `npm run build` passed. Vite's warning about the classic service-worker script is not itself a functional bug; the script is copied into the output.
- `npm run lint` failed and produced substantial dependency/generated-code noise. Directly linting `src` and `vite.config.ts` passed.
- Downloaded the exact single-thread engine referenced by the app: `@ffmpeg/core@0.12.6`. Ran its actual WebAssembly binary with synthetic audio/video, and exercised the app's command builder through a worker adapter. This verifies codec behavior without relying on the different FFmpeg version installed on the computer.
- Reproduced malformed AIFF metadata, collapsed snap boundaries, crossfade overshoot, ZIP overwriting, batch-index corruption, progress callback retention, and playback-clock jumps with isolated code executions.
- Verified with the exact engine: AMR encoder missing; several offered sample rates rejected; video retained in OGG/WebM/WMA exports; normalization output at 192 kHz; WAV `smpl` metadata dropped by normal conversion; FLAC loop tags left unchanged after resampling.
- Did not complete interactive browser testing, a real GitHub Pages deployment, a browser/device compatibility matrix, listening tests, or the multithread core. Browser-specific failure likelihoods remain conditional. The full conversion matrix was not exhaustively tested.
- One sequence of mixed successful and failed engine operations encountered an out-of-memory error and a later WASM memory trap. Fresh isolated normalization succeeded. That sequence is not treated as proof that normalization always fails; it reinforces the recovery concern in finding 26.

## Serious workflow and output failures

### 1. Clearing completed files during a batch can attach the wrong audio to another file — 8/10

**Where:** [BatchConverter.tsx:72](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:72), [BatchConverter.tsx:83](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:83), [BatchConverter.tsx:442](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:442).

**Error and why:** The running loop captures an old queue, but updates current state using array indexes. “Clear Completed” remains enabled during processing and removes earlier rows, shifting those indexes.

**If left:** With A complete, B processing, and C pending, clearing A makes B's result land on C. B can remain marked processing, and later updates can miss their intended rows. Users can download B's audio under C's name. **Reproduced** with the same array transformations.

**Fix:** Identify all state updates by immutable item ID. Process a snapshot of job IDs, and either disable structural queue changes during processing or explicitly support them by ID.

### 2. Switching app tabs silently destroys the current workspace — 7/10

**Where:** [App.tsx:18](/Users/bloomy/audio-lab/src/App.tsx:18).

**Error and why:** Conditional rendering unmounts the entire studio or converter. Their tracks, markers, settings, queue, results, and download links exist only in component state.

**If left:** Clicking Batch to inspect it discards a studio edit; switching back discards the batch. In-flight async work can continue after its component disappears, producing results the user cannot retrieve.

**Fix:** Keep both workspaces mounted, or lift persistent workspace/job state into a shared store. Give background jobs a lifecycle independent of the visible tab.

### 3. “Audio extraction” can export the video's picture as well — 7/10

**Where:** [ffmpegService.ts:104](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:104).

**Error and why:** The command does not explicitly select an audio stream or exclude video. FFmpeg automatically includes video for containers that allow it. **Reproduced**: an MP4 became WebM containing VP9 video, OGG containing Theora video, and WMA/ASF containing MPEG-4 video.

**If left:** Supposed audio files retain potentially sensitive visual content, take longer to encode, are larger, and can fail size limits. Multi-track sources can also select an unexpected language/commentary track because no stream choice is exposed. This follows [FFmpeg's stream-selection rules](https://www.ffmpeg.org/ffmpeg.html#Stream-selection).

**Fix:** Probe available audio streams, select the intended one, and use explicit mapping such as `-map 0:a:0 -vn -sn -dn`. Offer track selection where multiple audio streams exist.

### 4. AIFF loop metadata is structurally malformed — 7/10

**Where:** [audioMetadata.ts:238](/Users/bloomy/audio-lab/src/utils/audioMetadata.ts:238).

**Error and why:** The MARK chunk declares 34 payload bytes but actually contains 26. Its Pascal strings also receive unnecessary padding: the length byte plus five or three characters is already even. The next INST chunk therefore starts at a different offset from the one declared by MARK.

**If left:** Samplers and parsers can miss or misread loop markers/instrument data. **Reproduced**: the app's own parser could not read the loop chunks generated by its own writer. Audio itself may still play, hiding the metadata failure.

**Fix:** Construct marker records programmatically, pad each Pascal string according to its actual encoded length, derive chunk size from the final bytes, and round-trip the file through an independent parser.

### 5. Imported loop points use the wrong sample rate after browser decoding — 7/10

**Where:** [LoopStudio.tsx:129](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:129), [audioMetadata.ts:7](/Users/bloomy/audio-lab/src/utils/audioMetadata.ts:7).

**Error and why:** `decodeAudioData` resamples to the AudioContext's rate. The metadata parser divides sample offsets from the original file by the decoded buffer's rate. Those are different coordinate systems. Resampling during decoding is specified by the [Web Audio standard](https://www.w3.org/TR/webaudio/#dom-baseaudiocontext-decodeaudiodata).

**If left:** A 44,100-sample marker that means 1 second in a 44.1 kHz file becomes 0.91875 seconds in a 48 kHz context. Carefully authored game/sampler loops move and can click or cut notes.

**Fix:** Read the source rate from the original stream/container, interpret metadata in that rate, then convert to decoded-buffer samples. Handle Opus's defined timing/sample domain explicitly.

### 6. Loudness normalization silently changes output rate and breaks loop positions — 7/10

**Where:** [ffmpegService.ts:118](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:118), [LoopStudio.tsx:269](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:269).

**Error and why:** Dynamic `loudnorm` can output 192 kHz; the studio never supplies an output rate, and Batch's “Keep Original” supplies none. Metadata still uses pre-filter sample counts. **Reproduced**: a 48 kHz WAV became 192 kHz, approximately quadrupling PCM data size. See the [loudnorm documentation](https://www.ffmpeg.org/ffmpeg-filters.html#loudnorm).

**If left:** A full-loop endpoint expressed in 48 kHz samples describes only a quarter of the normalized 192 kHz output. Files unexpectedly grow and may exceed device/engine compatibility expectations.

**Fix:** Resolve and explicitly set the intended output sample rate after filtering. Scale metadata to the actual output rate and validate against the final frame count.

### 7. Zero-crossing snap can collapse or invalidate the loop — 7/10

**Where:** [LoopStudio.tsx:169](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:169), [zeroCrossing.ts:29](/Users/bloomy/audio-lab/src/utils/zeroCrossing.ts:29).

**Error and why:** Start and end are searched independently over overlapping 2,500-sample neighborhoods. Nothing enforces `start < end` afterward. The export helper masks an invalid length with `Math.max(1, ...)`.

**If left:** Short loops can snap both markers to the same crossing, or a single-marker snap can cross the other marker. Playback can behave unexpectedly and export can become a one-sample fragment. **Reproduced**: sample bounds 20–40 both snapped to sample 0.

**Fix:** Constrain each search to the valid side of the opposite boundary; enforce finite, ordered, in-range integer frame bounds centrally. Report when no valid crossing exists instead of silently accepting an invalid loop.

### 8. Batch target-size calculations pretend every file is 60 seconds — 7/10

**Where:** [BatchConverter.tsx:98](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:98).

**Error and why:** `item.duration` is never populated. Every calculation falls back to 60 seconds, regardless of file contents.

**If left:** Long recordings vastly exceed requested limits. For an hour-long recording targeting 8 MB, the app calculates 320 kbps using its fake minute duration: roughly 144 MB of audio payload before overhead. Short recordings can receive unnecessarily restrictive settings in other size/rate combinations.

**Fix:** Probe actual duration before choosing bitrate. Treat unknown duration as a visible inability to estimate, not as a made-up minute.

### 9. Completed ZIP downloads silently overwrite duplicate output names — 7/10

**Where:** [BatchConverter.tsx:112](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:112), [BatchConverter.tsx:158](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:158).

**Error and why:** `song.wav` and `song.flac` both become `song.mp3`; JSZip entries are keyed by name. The second replaces the first. **Reproduced** with the installed JSZip package.

**If left:** “Download All” produces an incomplete archive without warning, even though both rows show success. Users can delete or clear the only accessible copies believing everything was saved.

**Fix:** Assign unique output names before conversion/download, preserving every result with deterministic suffixes or per-source folders. Verify archive entry count.

### 10. Large inputs and repeat exports have no resource budget — 7/10

**Where:** [LoopStudio.tsx:124](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:124), [LoopStudio.tsx:251](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:251), [zeroCrossing.ts:141](/Users/bloomy/audio-lab/src/utils/zeroCrossing.ts:141), [BatchConverter.tsx:93](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:93).

**Error and why:** Files are fully read/decoded; export allocates a crossfaded buffer, potentially an 8× repeated float buffer, an intermediate WAV, and engine input/output. There are no decoded-duration, channel, allocation, or batch-memory checks. Loop preparation and sample serialization also run synchronously on the UI thread.

**If left:** A one-hour stereo 48 kHz decoded buffer alone is about 1.38 GB of float samples. Repeating it 8× needs about 11 GB before other copies. Browser tabs can freeze or terminate, especially on phones, losing the session.

**Fix:** Estimate decoded and output memory before allocation, impose useful limits, avoid materializing repeats where possible, move preparation into a worker, and process/release large jobs incrementally. Surface resource failures clearly.

## Audio quality, formats, and metadata

### 11. Target size is an estimate presented as a reliable fit — 6/10

**Where:** [ffmpegService.ts:77](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:77).

**Error and why:** The generic formula clamps all codecs to 24–320 kbps, assumes a fixed 16 kbps overhead allowance, and never checks final bytes. Its “MB” conversion also does not exactly match either decimal MB with FFmpeg's decimal kbps or binary MiB. Different codecs have different valid rates and overheads.

**If left:** Even after fixing duration, impossible size budgets silently produce oversized files; VBR can overshoot estimates, and tiny/long outputs may not fit. For an hour targeting 8 MB, the 24 kbps floor alone gives about 10.8 MB before overhead.

**Fix:** Define units precisely, use codec-specific limits, detect impossible requests, reserve measured overhead, and validate the output size. Retry at a lower rate where feasible; otherwise explain that the limit cannot be met.

### 12. AMR is offered, but its encoder does not exist in the selected engine — 6/10

**Where:** [ffmpegService.ts:259](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:259).

**Error and why:** The app requests `libopencore_amrnb`, absent from the actual core's encoder list. **Reproduced**: selecting AMR fails with `Unknown encoder 'libopencore_amrnb'`.

**If left:** Every AMR attempt on the verified core fails after users wait for engine loading/processing.

**Fix:** Remove/disable AMR for this build, or ship a core with that encoder and suitable AMR-NB parameters. Generate offered formats from verified engine capabilities rather than assumed FFmpeg support.

### 13. The UI offers sample rates incompatible with selected codecs — 6/10

**Where:** [BatchConverter.tsx:396](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:396), [ffmpegService.ts:132](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:132).

**Error and why:** One sample-rate menu is passed straight to every codec. **Reproduced**: Opus at 44.1 kHz, WebM/Opus at 22.05 kHz, and AC3 at 22.05 kHz fail. WMA at a preserved 96 kHz source rate also fails in the tested core.

**If left:** Ordinary menu selections trigger exports that cannot succeed. “Keep Original” also fails when an input rate is invalid for the target.

**Fix:** Maintain a codec capability matrix covering rate, channel count, bitrate, and encoder availability. Restrict incompatible choices and explicitly resample when preserving the source rate is impossible.

### 14. Playback does not preview crossfade, compression, or normalization — 6/10

**Where:** [audioPlayer.ts:105](/Users/bloomy/audio-lab/src/utils/audioPlayer.ts:105), [LoopStudio.tsx:251](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:251), [ffmpegService.ts:109](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:109).

**Error and why:** The player always plays the original buffer through a gain node. Crossfading and DSP happen only during export. The README nevertheless describes real-time compressor controls.

**If left:** Users move controls and hear no change; an apparently acceptable preview can export with very different dynamics, clipping, length, or loop transition.

**Fix:** Preview the same processed loop and DSP chain that will be exported, ideally with an A/B bypass. If processing must remain export-only, label that limitation and provide a rendered-output preview.

### 15. Equal-power crossfades can clip, and the app clips them before DSP can help — 6/10

**Where:** [zeroCrossing.ts:110](/Users/bloomy/audio-lab/src/utils/zeroCrossing.ts:110), [wavEncoder.ts:61](/Users/bloomy/audio-lab/src/utils/wavEncoder.ts:61).

**Error and why:** Equal-power gains can sum above 1 for correlated material. **Reproduced**: a constant full-scale signal produced a peak of approximately 1.414, or +3.01 dB. The 16-bit intermediate encoder hard-clamps it before export compression or loudness normalization.

**If left:** Previously clean audio gains permanent distortion at the loop transition. Turning on the compressor afterward cannot restore the clipped samples.

**Fix:** Keep the intermediate in floating point with headroom. Use an appropriate crossfade strategy for correlated material, detect overshoot, and apply any intentional limiting only after mixing, before final quantization.

### 16. The default crossfade changes loop duration without showing the resulting length — 5/10

**Where:** [LoopStudio.tsx:49](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:49), [zeroCrossing.ts:94](/Users/bloomy/audio-lab/src/utils/zeroCrossing.ts:94), [LoopStudio.tsx:319](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:319).

**Error and why:** Output length is selection length minus crossfade length, but the displayed Length remains the original selection. Crossfade defaults to 25 ms. **Reproduced**: 48,000 frames became 46,800 frames at 48 kHz.

**If left:** Beat-aligned loops no longer match their intended bar length, and repeated exports drift against a game's or DAW's grid. Short samples can lose up to half their selected duration.

**Fix:** Show actual exported duration and explain overlap shortening. Provide a duration-preserving mode for rhythmic loops or default to zero crossfade until users choose otherwise.

### 17. Studio exports discard source precision before the final codec — 6/10

**Where:** [LoopStudio.tsx:265](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:265), [ffmpegService.ts:241](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:241).

**Error and why:** The intermediate WAV is always 16-bit integer. WAV and AIFF exports are hard-coded to 16-bit as well, despite the README advertising WAV 16/24/32-bit and the UI saying “Bit-perfect.” Browser resampling and the default crossfade can change the signal further.

**If left:** High-resolution sources lose low-level information even when exported to FLAC or another lossless format. Users can mistake a modified 16-bit derivative for a preserved master.

**Fix:** Keep floating-point samples until final encoding, expose explicit bit depth where supported, dither appropriately when reducing depth, and reserve “bit-perfect” for a path that actually preserves original samples.

### 18. WAV loop endpoints have an off-by-one error — 6/10

**Where:** [audioMetadata.ts:130](/Users/bloomy/audio-lab/src/utils/audioMetadata.ts:130), [audioMetadata.ts:220](/Users/bloomy/audio-lab/src/utils/audioMetadata.ts:220), [LoopStudio.tsx:296](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:296).

**Error and why:** Internal buffer slicing uses an exclusive end. WAV `smpl` end is an inclusive sample index. The writer stores the exclusive count directly, and the reader does not convert inclusive end back to an exclusive bound.

**If left:** A loop covering N frames exports end=N although the last valid index is N−1. Samplers may clamp it, include an extra sample, or handle the invalid endpoint differently. Imported valid loops can lose their last frame.

**Fix:** Standardize internal bounds as `[start, endExclusive)`, write `endExclusive - 1` to WAV `smpl`, and add one when reading. Validate one-frame and full-file loops independently.

### 19. Imported metadata is trusted without validating against actual decoded frames — 6/10

**Where:** [LoopStudio.tsx:139](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:139), [zeroCrossing.ts:87](/Users/bloomy/audio-lab/src/utils/zeroCrossing.ts:87).

**Error and why:** Parsers check end greater than start, but the studio never verifies that offsets are finite safe integers within the track. Export reads source samples without bounds checks.

**If left:** Stale or malformed tags can initialize markers outside the file. Export can read `undefined`, generate NaNs that later become corrupted/silent samples, attempt unreasonable allocations, or fail. Browser exceptions are possible when bad coordinates reach playback/drawing.

**Fix:** Validate source metadata, translate rates, then require `0 <= start < end <= decodedLength`. Reject or visibly repair invalid tags before applying them. Enforce the same invariant at export.

### 20. FLAC loop metadata import is missing — 5/10

**Where:** [audioMetadata.ts:15](/Users/bloomy/audio-lab/src/utils/audioMetadata.ts:15).

**Error and why:** The dispatch recognizes FORM, RIFF, and OggS, but never FLAC's `fLaC` header. The README claims bidirectional OGG/FLAC loop metadata.

**If left:** Loading a FLAC with valid LOOPSTART/LOOPLENGTH starts with the whole file instead of its authored loop. Reopening the app's own FLAC export does not restore those loop points.

**Fix:** Parse FLAC STREAMINFO and VORBIS_COMMENT blocks or use a verified metadata library/prober. Include FLAC round-trip fixtures.

### 21. OGG/Opus comments are searched as arbitrary text rather than parsed — 4/10

**Where:** [audioMetadata.ts:155](/Users/bloomy/audio-lab/src/utils/audioMetadata.ts:155).

**Error and why:** The parser decodes only the first 64 KB of the entire binary file and searches with unanchored regular expressions. It does not reassemble paginated packets or respect comment lengths/field boundaries.

**If left:** Valid comments following large metadata are missed; a field value containing `LOOPSTART=...` can be mistaken for the real loop tag. Page boundaries can split a valid field so the regex cannot see it.

**Fix:** Parse Ogg lacing/packet boundaries and Vorbis/Opus comment structures, read complete relevant packets under a sensible metadata limit, and validate exact tag names and values.

### 22. Non-forward and additional loops are silently interpreted or discarded — 4/10

**Where:** [audioMetadata.ts:79](/Users/bloomy/audio-lab/src/utils/audioMetadata.ts:79), [audioMetadata.ts:127](/Users/bloomy/audio-lab/src/utils/audioMetadata.ts:127), [types/audio.ts:31](/Users/bloomy/audio-lab/src/types/audio.ts:31).

**Error and why:** AIFF accepts any nonzero sustain play mode as an ordinary loop. WAV reads only the first loop and ignores its type, fraction, and play count. The app's loop type cannot represent these distinctions.

**If left:** Ping-pong, reverse, finite-repeat, release, or multiple-loop sampler content can behave differently after import/export without a warning.

**Fix:** Preserve supported semantics explicitly. For unsupported ones, identify them and explain what will be simplified instead of presenting a faithful round trip.

### 23. Batch conversion drops loop metadata or preserves it with stale sample coordinates — 6/10

**Where:** [BatchConverter.tsx:100](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:100), [ffmpegService.ts:145](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:145).

**Error and why:** Batch never parses loop information or passes it to the service. Native container metadata behavior is left to FFmpeg. **Reproduced**: WAV-to-WAV conversion removed `smpl`. FLAC-to-FLAC resampling from 48 to 24 kHz retained LOOPSTART=4800 and LOOPLENGTH=19200 unchanged.

**If left:** Game assets lose loops, or copied sample-count tags play at twice the intended times after downsampling. Successful conversion does not mean metadata survived correctly.

**Fix:** Offer an explicit preserve-loop-metadata policy, parse before conversion, transform coordinates according to output rate/trimming, and write validated destination metadata. Warn when a target cannot represent it.

### 24. Metadata parsing reads outside declared chunk boundaries — 3/10

**Where:** [audioMetadata.ts:60](/Users/bloomy/audio-lab/src/utils/audioMetadata.ts:60), [audioMetadata.ts:121](/Users/bloomy/audio-lab/src/utils/audioMetadata.ts:121).

**Error and why:** Most safety checks use total file length rather than the chunk's declared extent. The AIFF marker check also permits exactly six remaining bytes before reading a seventh string-length byte.

**If left:** A truncated or malformed metadata chunk can read following chunk/audio bytes as markers or throw. Errors are swallowed into “no metadata,” which obscures damaged files. DataView bounds prevent native out-of-bounds access; this is not claimed as a memory exploit.

**Fix:** Compute and validate chunk ends with checked arithmetic; validate every field against its chunk's end, validate declared FORM/RIFF extents, and distinguish malformed metadata from absence.

## State, processing, and resource management

### 25. Progress updates remain attached to the very first conversion — 5/10

**Where:** [ffmpegService.ts:14](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:14), [ffmpegService.ts:29](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:29).

**Error and why:** The progress listener closes over `onProgress` only when the engine is first loaded. Later `load(onProgress)` calls return the cached engine without rebinding the listener.

**If left:** Later jobs sit at zero then jump to done, while engine progress can update an earlier row or an unmounted studio. **Reproduced**: later per-job callbacks received only the explicit “Encoding” event, while engine events continued going to the initial callback.

**Fix:** Register a scoped listener for each job and remove it in `finally`, or route events through a current-job callback with a stable job ID.

### 26. There is no cancel, execution deadline, or reliable engine recovery path — 6/10

**Where:** [ffmpegService.ts:52](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:52), [ffmpegService.ts:158](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:158).

**Error and why:** Loading/encoding has no application timeout or abort UI. The singleton's loaded state is never reset after a fatal execution/runtime problem, and failed initializations do not terminate their worker. The installed API provides `terminate` and an execution timeout, but the app uses neither.

**If left:** A hung job can leave processing controls disabled indefinitely; a bad engine instance can poison subsequent jobs until page reload. Switching tabs does not safely cancel it and can add another job to the shared engine.

**Fix:** Add job cancellation, load/execution deadlines, worker error handling, and a reset/reload path that terminates the old engine, rejects outstanding jobs, clears state, and permits retry.

### 27. Blob URLs leak large files, repeatedly — 6/10

**Where:** [BatchConverter.tsx:541](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:541), [LoopStudio.tsx:159](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:159), [LoopStudio.tsx:301](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:301), [ffmpegService.ts:42](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:42).

**Error and why:** Batch creates a new object URL during every render and never revokes it. Studio URLs are replaced/discarded without revocation. Engine JS/WASM/worker blob URLs also lack a cleanup lifecycle.

**If left:** Every progress update can create more URLs for previously completed outputs. Clearing rows or switching workspaces does not release those URL references. Long sessions retain substantial memory until document unload.

**Fix:** Create each download URL once, store it with its result, and revoke it on replacement/removal/unmount. Revoke engine asset URLs at the appropriate engine disposal point, accounting for workers that still require them.

### 28. AudioContexts are never closed — 4/10

**Where:** [LoopStudio.tsx:89](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:89), [audioPlayer.ts:24](/Users/bloomy/audio-lab/src/utils/audioPlayer.ts:24).

**Error and why:** Cleanup stops playback but leaves the context, audio graph, buffer references, and callbacks without a disposal method.

**If left:** Repeated studio/tab sessions can retain audio resources unnecessarily. Depending on browser/device limits, later contexts can fail or resource/battery usage can remain elevated.

**Fix:** Implement player disposal: stop nodes/animation, clear callbacks and buffers, disconnect the graph, and close the context when that workspace/player is permanently destroyed.

### 29. Slow file loads can overwrite a newer file selection — 5/10

**Where:** [LoopStudio.tsx:124](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:124).

**Error and why:** Async read, decode, and metadata parsing have no load-generation token or cancellation check. There is no loading lock/status preventing another selection.

**If left:** Select large A, then smaller B: if A finishes last, A replaces B despite the user's latest choice. Loading can also complete after the studio has unmounted.

**Fix:** Increment a request token on each selection and commit only the latest result. Expose loading/error status, cancel obsolete work when possible, and ignore completions after disposal.

### 30. Loading another file during export can display the old file's result under the new workspace — 5/10

**Where:** [LoopStudio.tsx:238](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:238), [LoopStudio.tsx:301](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:301), [LoopStudio.tsx:381](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:381).

**Error and why:** Load Different File remains enabled while export is active. The old export closure later publishes its URL/name into the same component after the new track cleared that result.

**If left:** The visible waveform is B, but Export Ready/download refers to A. Users can save or distribute the wrong asset.

**Fix:** Tie every result to track ID and an immutable settings snapshot. Ignore superseded completions or show them as separate jobs; alternatively disable file replacement until cancellation/completion.

### 31. Old exports remain labeled ready after edits or failed re-exports — 5/10

**Where:** [LoopStudio.tsx:117](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:117), [LoopStudio.tsx:306](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:306), [LoopStudio.tsx:930](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:930).

**Error and why:** Editing boundaries, crossfade, DSP, or output settings does not invalidate or label the existing result. Starting a new export also keeps the old URL; failure reveals the old Export Ready state again.

**If left:** A download appears to correspond to current settings even though it contains an earlier edit, possibly in a different format.

**Fix:** Store the result's input/settings revision and mark it outdated after changes. On failure, show the failure and label any retained prior download explicitly.

### 32. Engine availability depends on a live third-party CDN with no local fallback — 5/10

**Where:** [ffmpegService.ts:37](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:37).

**Error and why:** Every fresh page engine load fetches JS/WASM from unpkg; no app-managed offline engine cache or same-origin fallback exists. If the multithread core fails, there is no retry with the single-thread core. The verified WASM download alone is about 30.6 MiB.

**If left:** An otherwise loaded site cannot export when offline, behind a CDN block, or during a CDN failure. A locally processed app is not necessarily an offline app. Audio bytes are not uploaded by this code, but engine requests still contact a third party.

**Fix:** Ship versioned engine assets with the app or reliably cache them, expose real loading progress and retry, and fall back from multithread initialization when appropriate. Describe the network dependency accurately.

### 33. Useful encoding errors are hidden from users — 4/10

**Where:** [ffmpegService.ts:159](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:159), [BatchConverter.tsx:554](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:554).

**Error and why:** The service throws only an exit code instead of retaining FFmpeg log diagnostics. Batch truncates the error with no details view; studio uses blocking alerts.

**If left:** Missing encoder, unsupported rate, corrupt input, and memory failure all look like the same unexplained error. Users cannot choose a corrective setting and repeatedly retry doomed jobs.

**Fix:** Capture a bounded log tail per job, classify known failures into actionable explanations, and provide expandable/copyable details with a retry option.

### 34. ZIP generation has no error, busy, or cancellation handling — 5/10

**Where:** [BatchConverter.tsx:153](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:153).

**Error and why:** `generateAsync` has no surrounding catch or busy guard. Repeated clicks can build multiple full archives concurrently; all output is collected in memory. The download URL is revoked immediately after clicking, which is also a compatibility risk for browsers that consume it later.

**If left:** Large archives can exhaust memory or fail with an unhandled rejection and no visible explanation. Users can trigger additional expensive work because nothing says it is running.

**Fix:** Track ZIP generation state/progress, disable duplicate requests, catch failures, provide cancellation/size limits or streaming where supported, and delay URL revocation until the browser has had time to consume it.

## Controls, playback, and accessibility

### 35. Several visible compression modes have no corresponding implementation — 5/10

**Where:** [BatchConverter.tsx:275](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:275), [LoopStudio.tsx:799](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:799), [ffmpegService.ts:245](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:245), [ffmpegService.ts:270](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:270).

**Error and why:** Batch AIFF falls into the lossy-mode menu despite being forced to 16-bit PCM; its controlled mode initially has no matching option. Raw PCM gets CBR/VBR/target-size choices in both workspaces, but its codec branch ignores them.

**If left:** Users ask for compressed AIFF/raw PCM or a file-size limit and receive fixed PCM output of a different size. Raw files also provide no downloadable rate/channel/endianness description, making correct re-import harder.

**Fix:** Offer only meaningful modes per format. For raw output, expose and preserve explicit PCM parameters and provide an import-settings summary or sidecar.

### 36. VBR and CBR labels do not consistently match encoder behavior — 5/10

**Where:** [ffmpegService.ts:195](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:195), [ffmpegService.ts:213](/Users/bloomy/audio-lab/src/services/ffmpegService.ts:213), [LoopStudio.tsx:809](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:809), [BatchConverter.tsx:285](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:285).

**Error and why:** Only MP3 and Vorbis implement a VBR quality option, and neither UI exposes its quality value. AAC, WMA, AC3, and WebM VBR selections do not select a distinct VBR quality path. Opus always uses `-vbr on`, including when CBR is selected. Vorbis bitrate targeting should not be advertised as a strict constant rate without verification.

**If left:** Changing modes may do nothing, unexpectedly reuse a hidden old bitrate, or produce variable-size output despite a CBR request.

**Fix:** Define supported modes separately per codec, expose actual quality/bitrate controls, and use verified codec-specific flags. Remove unsupported promises.

### 37. Playback position becomes wrong when looping or loop points change live — 5/10

**Where:** [audioPlayer.ts:50](/Users/bloomy/audio-lab/src/utils/audioPlayer.ts:50), [audioPlayer.ts:61](/Users/bloomy/audio-lab/src/utils/audioPlayer.ts:61), [audioPlayer.ts:188](/Users/bloomy/audio-lab/src/utils/audioPlayer.ts:188).

**Error and why:** Position is calculated from the original start time/offset but uses the current loop settings. Changing those settings retroactively changes the interpretation of all elapsed playback time.

**If left:** The playhead can jump away from what is actually sounding. Pausing stores this wrong position and resuming then seeks to it. **Reproduced** with a deterministic clock: after looping 2–4 seconds, disabling looping changed reported position immediately from 3 to 5 seconds.

**Fix:** Before changing loop mode/bounds, compute the old actual position, rebase the playback timeline, then update or restart the source at that position.

### 38. Phones/tablets cannot drag loop markers with touch — 7/10

**Where:** [WaveformVisualizer.tsx:360](/Users/bloomy/audio-lab/src/components/WaveformVisualizer.tsx:360).

**Error and why:** The waveform implements mouse handlers only. There are no pointer/touch drag handlers or alternate editable loop inputs.

**If left:** Touch users may tap via synthesized mouse clicks, but sustained marker/region editing is not implemented reliably. The app's primary loop-editing workflow is effectively unavailable to a significant device class.

**Fix:** Implement Pointer Events with pointer capture, appropriate touch-action behavior, and sufficiently large handles. Provide numeric/frame-based controls that work independently of dragging.

### 39. Loop boundaries cannot be edited with the keyboard — 6/10

**Where:** [WaveformVisualizer.tsx:360](/Users/bloomy/audio-lab/src/components/WaveformVisualizer.tsx:360), [LoopStudio.tsx:466](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:466).

**Error and why:** Markers exist only as painted canvas pixels; timecodes are read-only spans. The canvas has no keyboard editing model or accessible equivalent.

**If left:** Keyboard-only and screen-reader users cannot author arbitrary loops, and precise sample/frame edits are unavailable even for mouse users.

**Fix:** Add labeled editable start/end time and frame inputs with validation, plus keyboard nudging. Expose selected boundaries and playback position as meaningful accessible controls/state.

### 40. Form labels and the help dialog are incompletely accessible — 5/10

**Where:** [BatchConverter.tsx:232](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:232), [LoopStudio.tsx:650](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:650), [Header.tsx:103](/Users/bloomy/audio-lab/src/components/Header.tsx:103).

**Error and why:** Many labels are siblings without `htmlFor`/IDs, compressor sliders use unassociated text spans, and canvas/pan controls lack useful accessible naming. The help overlay has no dialog semantics, focus placement/trap/restoration, Escape handling, or labeled close button. Progress is mostly visual without an announced status model.

**If left:** Assistive technology users hear ambiguous sliders/selects, cannot reliably determine processing status, and can tab into the page behind a supposedly modal overlay.

**Fix:** Associate labels programmatically, add names and appropriate state/value semantics, use a properly implemented dialog component/native dialog, and announce meaningful job transitions with restrained live-region updates.

### 41. Global keyboard shortcuts interfere with focused buttons and the help modal — 4/10

**Where:** [LoopStudio.tsx:94](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:94).

**Error and why:** The global Space handler excludes inputs/selects but not buttons, textareas, editable content, or an open modal. It prevents the browser's default button activation. It also responds to repeated keydown events.

**If left:** Pressing Space on Export, Load, or a help button can play/pause audio instead of activating the focused control. Holding a shortcut can toggle repeatedly. Audio can be controlled unintentionally while help is open.

**Fix:** Scope shortcuts to the active editing surface, ignore editable/interactive targets and `event.repeat`, and suspend background shortcuts while dialogs are open.

### 42. Resizing while paused leaves the waveform at stale rendering resolution — 3/10

**Where:** [WaveformVisualizer.tsx:89](/Users/bloomy/audio-lab/src/components/WaveformVisualizer.tsx:89), [WaveformVisualizer.tsx:274](/Users/bloomy/audio-lab/src/components/WaveformVisualizer.tsx:274).

**Error and why:** Canvas backing dimensions are refreshed only when listed React dependencies change. Browser resize/orientation/DPR changes are not observed.

**If left:** A paused waveform can be stretched or blurry after window resizing, display changes, or device rotation. Text, line thickness, and the cached drawing's aspect can remain wrong until another state change forces a redraw. CSS scaling usually preserves the horizontal time mapping, so this is primarily a rendering-quality problem.

**Fix:** Observe the container with ResizeObserver, update drawing dimensions/DPR when needed, and derive render/hit-test transforms from the same current viewport.

### 43. The waveform overstates precision and hides other channels — 5/10

**Where:** [WaveformVisualizer.tsx:44](/Users/bloomy/audio-lab/src/components/WaveformVisualizer.tsx:44), [WaveformVisualizer.tsx:46](/Users/bloomy/audio-lab/src/components/WaveformVisualizer.tsx:46), [WaveformVisualizer.tsx:351](/Users/bloomy/audio-lab/src/components/WaveformVisualizer.tsx:351), [LoopStudio.tsx:375](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:375).

**Error and why:** About 4,000 envelope buckets are reused at every zoom, zoom is capped at 32×, and only channel 0 is shown. For a three-minute file each bucket summarizes roughly 45 ms, regardless of how much it is magnified. Files with more than one channel are all labeled Stereo.

**If left:** Users cannot inspect individual samples or independently identify transients/clicks in other channels as the README's sub-millisecond language suggests. A silent left channel can make a non-silent file look silent; surround audio is mislabeled.

**Fix:** Use multiresolution peaks with direct sample rendering at high zoom, show channel information accurately, and offer all-channel views plus exact frame controls.

### 44. Zero-crossing snap does not guarantee zero amplitude or matching stereo phase — 5/10

**Where:** [zeroCrossing.ts:35](/Users/bloomy/audio-lab/src/utils/zeroCrossing.ts:35), [LoopStudio.tsx:509](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:509).

**Error and why:** The detector chooses the sample before a channel-0 sign change, which need not have zero amplitude. Other channels are scored by absolute amplitude, not jointly matched boundary value/slope. If no crossing exists it returns the original position with no failure indication.

**If left:** Stereo loops can still click after a successful-looking snap, especially with the crossfade off. A rising crossing at both ends is not proof of matching waveform phase or discontinuity-free joining.

**Fix:** Report whether a valid candidate was found, score boundary pairs across all channels for discontinuity/slope, distinguish nearest sample from an exact interpolated crossing, and avoid guarantees that the algorithm cannot meet.

### 45. Changing global batch settings mislabels already completed files — 4/10

**Where:** [BatchConverter.tsx:81](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:81), [BatchConverter.tsx:505](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:505).

**Error and why:** Processing captures one global settings object, but every row renders the current `globalFormat`. Controls remain changeable during processing. The per-item `options` snapshot exists but is not used to describe actual processing/results.

**If left:** A completed MP3 can be labeled FLAC after the dropdown changes; in-progress jobs still use old settings while appearing to use new ones. Running Convert again skips completed items, so changing settings does not reconvert them.

**Fix:** Record the applied settings/output format on each job and display those. Clearly distinguish settings for future jobs and provide an explicit reconvert/reset-results action.

### 46. Files added during processing are left behind by that run — 3/10

**Where:** [BatchConverter.tsx:49](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:49), [BatchConverter.tsx:83](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:83), [BatchConverter.tsx:184](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:184).

**Error and why:** Upload remains active, but the running loop iterates the queue captured when processing began. Newly appended files are not part of it.

**If left:** The app eventually stops with visible pending files despite “Convert & Compress All.” A user expecting an actively draining queue must notice and start another run.

**Fix:** Either disable adding during a fixed batch, explicitly label additions as next-batch jobs, or use a job runner that consumes pending IDs until the queue is empty.

## Delivery and maintenance oversights

### 47. Documented automatic GitHub Pages deployment does not exist — 5/10

**Where:** [README.md:64](/Users/bloomy/audio-lab/README.md:64).

**Error and why:** The README says an automated GitHub Actions deployment workflow is included. There is no `.github/workflows` file in the supplied folder.

**If left:** Following the instructions and choosing GitHub Actions does not create a build/deploy pipeline. Pushing main will not publish the site as promised.

**Fix:** Add and verify an actual Pages build/artifact/deploy workflow, including necessary permissions and deployment environment, or document an existing manual deployment process accurately.

### 48. There is no gitignore despite instructions to run `git add .` — 3/10

**Where:** [README.md:69](/Users/bloomy/audio-lab/README.md:69), project root.

**Error and why:** The supplied folder contains `node_modules`, `dist`, and `.DS_Store` files but no `.gitignore`.

**If left:** The recommended initialization can stage dependencies, machine metadata, and generated output, producing a large/noisy repository and avoidable review/deployment problems. I did not find or infer exposed credentials.

**Fix:** Add appropriate ignore rules before initialization for dependencies, build output, OS files, local environment files, and temporary artifacts; retain the lockfile and intended source assets.

### 49. The lint script scans dependency/generated code instead of providing a useful project check — 3/10

**Where:** [package.json:10](/Users/bloomy/audio-lab/package.json:10).

**Error and why:** `npm run lint` runs bare `oxlint` without project scoping or ignore configuration. In this folder it scanned dependency files and returned failure with excessive noise. A scoped lint of application source and Vite config passed.

**If left:** A developer or future CI cannot readily separate their own mistakes from vendor/generated warnings and may stop trusting the check.

**Fix:** Scope linting to maintained source/config files or configure explicit ignores for dependencies, output, and vendored service-worker code. Make the documented lint command pass for the actual project.

### 50. There is no regression coverage for the app's most failure-prone contracts — 4/10

**Where:** [package.json:6](/Users/bloomy/audio-lab/package.json:6), project source tree.

**Error and why:** No test script or tests cover loop boundary math, sample-rate translation, binary chunks, output stream types, codec settings, or queue identity. These are unusually easy to get wrong while the UI and TypeScript build remain clean.

**If left:** Fixes to one format or workflow can quietly break another, and malformed exports continue to look successful. This is a reliability gap rather than a claim that every missing test is independently a user-facing bug.

**Fix:** Add a focused suite using tiny deterministic fixtures: independent AIFF/WAV metadata round trips, inclusive/exclusive boundaries, mismatched source/context rates, normalized output rates, codec capability cases, audio-only video extraction, snap invariants, duplicate ZIP names, and state transitions while jobs run. Keep browser smoke coverage for upload → preview → export → inspect output.

## Additional input and editing compatibility findings

### 51. Studio's advertised universal input support has no decoder fallback — 6/10

**Where:** [LoopStudio.tsx:131](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:131), [LoopStudio.tsx:341](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:341).

**Error and why:** Studio relies entirely on browser-native `decodeAudioData`, while claiming universal browser support for audio and video formats. Accepting a file in the picker does not mean the browser can decode its container/codec; there is no FFmpeg decode/demux fallback. Codec support varies by browser/platform, as described in the [Web Audio decoding API documentation](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData).

**If left:** A valid asset can convert in Batch but fail to load in Studio on the same computer. Unsupported video containers or audio codecs receive only a load-error alert despite the advertised support. Exact affected formats need a browser/platform matrix; this review does not claim every named format fails everywhere.

**Fix:** Use the engine to demux/decode to a known PCM representation when native decoding fails, then load that into Web Audio. Preserve source metadata and sample rate explicitly. Publish verified input support rather than treating MIME picker filters as a capability guarantee.

### 52. Loading a different track keeps the previous track's zoom/pan — 3/10

**Where:** [WaveformVisualizer.tsx:25](/Users/bloomy/audio-lab/src/components/WaveformVisualizer.tsx:25), [WaveformVisualizer.tsx:38](/Users/bloomy/audio-lab/src/components/WaveformVisualizer.tsx:38), [LoopStudio.tsx:400](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:400).

**Error and why:** The visualizer remains mounted when the track changes. Its audio-buffer effect updates peak data but does not reset zoom, pan, or drag state.

**If left:** A newly loaded file can open deeply zoomed into an unrelated part of its timeline, hiding the start/end markers and confusing users who expect a full overview. This is recoverable with Fit.

**Fix:** Reset the viewport/drag state on track identity changes, or key the visualizer by track ID. If retaining the view is intentional, provide an explicit preference and sensible bounds.

### 53. File pickers do not reset, so reselecting the same file may do nothing — 3/10

**Where:** [BatchConverter.tsx:211](/Users/bloomy/audio-lab/src/components/BatchConverter.tsx:211), [LoopStudio.tsx:392](/Users/bloomy/audio-lab/src/components/LoopStudio.tsx:392).

**Error and why:** After consuming the FileList, the input value remains selected. A repeated selection of the same file need not fire a new change event.

**If left:** Remove a queued file and try to add it again, or reload an externally edited current studio file: the apparent selection can have no effect until the user chooses a different file or reloads the app. Exact picker behavior is browser-dependent.

**Fix:** Capture the selected File objects, then reset the input value to an empty string after handling the selection, including failed loads.

## Recommended order

1. Fix queue identity and preserve workspace/job state (1–2), then unique ZIP names (9).
2. Fix audio-only mapping, AIFF structure, sample-rate coordinate handling, WAV endpoints, and loop-bound validation (3–7, 18–19).
3. Correct target-size behavior and remove impossible codec/settings combinations (8, 11–13, 35–36).
4. Make previews truthful, preserve float precision/headroom, and show actual export duration (14–17).
5. Add resource limits, cancellation/recovery, URL/context cleanup, and correct per-job progress (10, 25–28).
6. Repair accessible/touch editing, error feedback, delivery instructions, and focused regression coverage.

Do not treat cosmetic polish or a successful build as a substitute for inspecting the exported files. The main risk here is plausible-looking success with incorrect audio, incorrect metadata, or missing results.
