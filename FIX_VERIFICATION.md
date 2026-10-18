# Audio Lab fixes and verification

Implemented October 17, 2026. The original audit is preserved in `AUDIO_LAB_REVIEW.md` as a historical record; its line references describe the pre-fix code.

## What changed

The conversion path now uses a shared, validated output-settings model and a pinned, same-origin FFmpeg core (0.12.10). Jobs serialize across both workspaces, support cancellation while queued or active, validate actual source information with FFprobe, clean temporary files, and release the engine/heap after each job. This avoids retained codec state and reduces long-session memory use.

WAV, AIFF, FLAC, Vorbis, and Opus metadata parsing/writing uses explicit frame conventions and source sample rates. Whole-track export keeps the intro/tail; region export uses a worker with a floating-point intermediate and explicit frame counts. Crossfade defaults to off. Batch results use item identities, immutable applied settings, and unique archive filenames. Both workspaces survive navigation between tabs.

Controls were made accessible and responsive, including touch/pointer editing, exact frame inputs, source/processed previews, meaningful processing errors, and a native help dialog. The old service-worker reload behavior is removed; legacy registrations belonging to this app are retired without reloading the page.

Some misleading promises were deliberately replaced with accurate behavior: DSP/normalization are export-only with rendered-output audition; overlap crossfade is linear and explicitly shortens the region; AMR is unavailable; Opus/WebM output uses a 48 kHz clock and explicit 10 ms frames; supported sample rates/modes are constrained; multichannel sources require an explicit mono/stereo downmix before Studio editing. These choices are documented in the app and README.

## Trusted supplied fixtures

The original files were opened read-only, and their SHA-256 values were checked before/after verification. No source audio was copied into `public/` or `dist/`. A private, Git-ignored manifest references their existing paths. Output artifacts are in the Git-ignored `artifacts/fixture-tests/` folder.

| Fixture                              |      Rate | Decoded frames | Preserved loop, exclusive end |
| ------------------------------------ | --------: | -------------: | ----------------------------- |
| SwitchSports_Tennis.aif              | 48,000 Hz |      7,077,888 | None originally               |
| SwitchSports_Tennis.looped.aiff      | 48,000 Hz |      7,077,888 | 1,408,664 → 7,052,761         |
| RP_Tns_Bgm_GameResultDisp…looped.wav | 48,000 Hz |      1,779,528 | 313,344 → 1,779,528           |
| RP_Tns_Bgm_GameResultDisp…wav        | 48,000 Hz |      1,779,528 | None originally               |
| Rainbow Road ALAC/M4A                | 44,100 Hz |      7,400,597 | None originally               |
| Wuhu Loop & Maka Wuhu FLAC           | 44,100 Hz |      7,852,218 | None originally               |

For the WAV, its stored inclusive `smpl` end is 1,779,527. The UI/internal exclusive endpoint 1,779,528 describes the same loop; it is not an automatic snap or timing change. AIFF authored marker positions are retained as supplied.

For all six files, full-length, unprocessed 16-bit WAV exports have **identical independently decoded PCM hashes** to their sources. Cover art is excluded. Both trusted loops also pass WAV/AIFF/FLAC cross-format export with resampling to 24 kHz and correctly scaled frame coordinates. The private machine-readable results are in `artifacts/fixture-tests/verification.json`.

## Audit resolution map

| Finding | Resolution                                                                                                                                           | Verification / limit                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Queue updates use immutable IDs; structural changes are disabled while processing.                                                                   | Browser batch/ZIP test; no index-based mutations.                                                                                           |
| 2       | Both workspaces remain mounted; hidden Studio pauses playback.                                                                                       | Browser tab-switch tests retain edits and completed results. Refresh/close still clears the session, as disclosed.                          |
| 3       | Explicit audio mapping and `-vn -sn -dn`; artwork/non-audio streams excluded. Track selection is available in Studio and via Batch track inspection. | Real WASM synthetic-video tests for WebM/OGG/WMA/M4A, plus supplied artwork fixtures.                                                       |
| 4       | AIFF MARK/INST sizes, marker references, and Pascal-string alignment corrected.                                                                      | Independent source fixtures and generated round trips.                                                                                      |
| 5       | Source-rate decoding and metadata coordinates are explicit; device output rate is not used for source markers.                                       | 44.1/48 kHz unit and supplied-file browser tests.                                                                                           |
| 6       | Filtering is followed by an explicit output rate; marker coordinates are rescaled.                                                                   | Normalized WAV retains rate/frame count/loop markers.                                                                                       |
| 7       | Snap searches obey the opposite boundary; export requires valid integer bounds.                                                                      | Tiny-loop and invalid-region regressions.                                                                                                   |
| 8       | Source duration is probed; the fake 60-second fallback is gone.                                                                                      | WASM probe and size-mode tests.                                                                                                             |
| 9       | Case-insensitive unique output/archive names preserve every result.                                                                                  | Real JSZip/browser duplicate-name test.                                                                                                     |
| 10      | Input, decoded/preparation, queue, and result budgets; worker preparation writes repeats directly into final float WAV.                              | Budget rejection tests and full supplied AIFF region export. Limits reduce risk; device memory still varies.                                |
| 11      | Decimal MB, bounded retries, actual final-byte verification, and impossible-budget errors.                                                           | Size-limited MP3 plus impossible-budget regression.                                                                                         |
| 12      | AMR removed from offered formats.                                                                                                                    | Every advertised output format is encoded by the shipped engine.                                                                            |
| 13      | Format-specific rate menus and service validation; incompatible source rates produce resampling notices.                                             | All 91 offered format/rate combinations tested with default mode settings.                                                                  |
| 14      | Prepared crossfade audition; DSP/normalization labeled export-only; rendered-output player.                                                          | Browser worker/export flow, decoder fallback, rendered download inspection.                                                                 |
| 15      | Convex linear crossfade cannot create correlated-signal overshoot; float intermediates avoid premature quantization.                                 | Full-scale constant signal, float-headroom, compressor/limiter tests.                                                                       |
| 16      | Crossfade defaults off; actual overlap shortening and repeated export length are shown.                                                              | Browser worker export has the expected frame count.                                                                                         |
| 17      | Float region intermediate; explicit 16/24/32-bit PCM and 16/24-bit FLAC/ALAC; false bit-perfect claim removed.                                       | Depth matrix; independent full-file PCM equality for supplied 16-bit sources.                                                               |
| 18      | WAV inclusive end converts to/from the exclusive internal endpoint.                                                                                  | One/full-file boundary and metadata round-trip tests.                                                                                       |
| 19      | Imported markers are validated against source/decoded bounds, with diagnostics for invalid metadata.                                                 | Malformed/bounds tests and trusted fixture comparisons.                                                                                     |
| 20      | FLAC STREAMINFO and VORBIS_COMMENT parsing implemented.                                                                                              | Engine-generated FLAC round trips and supplied FLAC source test.                                                                            |
| 21      | Ogg page lacing and packet/comment lengths are parsed, rather than regex scanning arbitrary bytes.                                                   | Vorbis/Opus real-engine metadata round trips; metadata size is bounded.                                                                     |
| 22      | Unsupported loop semantics are identified and reported.                                                                                              | Parser checks type/fraction/play count/release loops. Only one forward sustain loop is supported.                                           |
| 23      | Batch reads/transforms loop coordinates and writes supported destination metadata.                                                                   | Supplied WAV/AIFF cross-format/resampling tests.                                                                                            |
| 24      | Reads are bounded by declared container/chunk/comment extents.                                                                                       | Truncated chunk/comment and malformed-length checks.                                                                                        |
| 25      | Per-job progress listeners are installed/removed with the job.                                                                                       | Subsequent jobs do not call earlier callbacks.                                                                                              |
| 26      | Cancellable serialized jobs, encode/job deadlines, engine termination/reset, and immediate queued cancellation.                                      | Queued cancellation unit test, bad-file recovery, active cancellation browser test.                                                         |
| 27      | No render-time object URLs. Studio replaces/revokes URLs; batch downloads use temporary URLs with delayed revocation.                                | Lifecycle review and repeated browser workflow.                                                                                             |
| 28      | Player disposal closes context, disconnects nodes, stops animation, and clears callbacks/buffers.                                                    | Player disposal and pending-playback race tests.                                                                                            |
| 29      | Load-generation tokens and abort controllers reject obsolete file-load results.                                                                      | Source lifecycle guards and sequential supplied-file browser loads.                                                                         |
| 30      | Export locks file replacement; results carry a track/settings revision.                                                                              | Explicit job state and browser result-revision test.                                                                                        |
| 31      | Settings changes label earlier exports as previous results; failures/cancellation remain visible.                                                    | Browser stale-result test.                                                                                                                  |
| 32      | Engine assets are pinned and bundled locally; no runtime CDN dependency.                                                                             | Production browser and subdirectory request-origin checks. First site load still needs its assets.                                          |
| 33      | Bounded engine log diagnostics and readable error details replace bare exit codes/alerts.                                                            | Invalid-file and unsupported-setting regressions.                                                                                           |
| 34      | ZIP busy/progress/error handling, duplicate-click guard, output budget, delayed URL revocation.                                                      | Browser archive test. JSZip building is not cancellable once started.                                                                       |
| 35      | AIFF/raw/ALAC expose lossless modes only; raw parameters are displayed with results.                                                                 | Shared settings validation/mode tests.                                                                                                      |
| 36      | Only implemented VBR/bitrate modes are shown; actual quality controls are exposed; Opus CBR disables VBR.                                            | Real-engine codec/mode matrix. AAC/native codec bitrate behavior is described as bitrate targeting, not a strict CBR guarantee.             |
| 37      | Playback state changes rebase the timeline before updating loop behavior.                                                                            | Deterministic player-clock tests.                                                                                                           |
| 38      | Pointer capture supports real touch marker drags.                                                                                                    | Chromium CDP touch gesture on a mobile viewport.                                                                                            |
| 39      | Exact labeled start/end frame inputs support keyboard editing.                                                                                       | Browser keyboard edits and validated export coordinates.                                                                                    |
| 40      | Associated labels, meaningful names/status, native modal focus/Escape handling.                                                                      | Axe scans: no serious/critical violations in loaded Studio, Batch, or Help. Automated checks are not a complete assistive-technology audit. |
| 41      | Shortcuts ignore interactive/editable targets, modifiers, repeated events, hidden Studio, and dialogs.                                               | Keyboard dispatch guards and native dialog tests.                                                                                           |
| 42      | ResizeObserver/DPR-aware canvas sizing.                                                                                                              | Browser viewport resizing checks drawing width against physical pixel size.                                                                 |
| 43      | Multiresolution envelopes, high zoom with sample rendering, all-channel display, accurate channel labels.                                            | Rendering implementation plus browser smoke/resize checks.                                                                                  |
| 44      | Snap reports absence and is explicitly described as approximate/channel-1 based.                                                                     | No-candidate/boundary regressions; no stereo phase or click-free guarantee remains.                                                         |
| 45      | Applied settings are stored per job; controls lock while running; completed rows retain actual format.                                               | Browser batch result/persistence tests.                                                                                                     |
| 46      | Adding files is paused during a fixed batch; behavior is explained.                                                                                  | Disabled controls and guarded drop handler.                                                                                                 |
| 47      | Actual Pages test/build/deploy workflow added.                                                                                                       | Production build and simulated Pages subdirectory test. Not published to a live repository in this task.                                    |
| 48      | Ignore rules cover dependencies, build output, local fixtures, private artifacts, OS files, and environment files.                                   | Filesystem/build-output inspection.                                                                                                         |
| 49      | Lint scopes maintained application/test/config files.                                                                                                | `npm run lint` passes.                                                                                                                      |
| 50      | Audio, engine, player, private-fixture, and production-browser regression suites added.                                                              | Commands below.                                                                                                                             |
| 51      | Browser decode failure uses local FFmpeg PCM fallback; unsupported inputs fail clearly.                                                              | Forced native-decoder failure followed by real engine fallback in Chromium.                                                                 |
| 52      | Visualizer is keyed to the loaded track identity, resetting viewport/drag state.                                                                     | Supplied-file replacement workflow.                                                                                                         |
| 53      | File inputs reset after capture; hidden file controls cannot overflow the mobile layout.                                                             | Repeated file uploads and mobile scroll-width regression.                                                                                   |

## Final results

- `npm run lint`: passed.
- `npm test`: **28/28 passed**, including a parameterized matrix of **91 format/rate combinations**, all 13 advertised output formats, bit depths, ADPCM variants, and VBR modes.
- `npm run test:fixtures`: **8/8 passed**, using all six supplied originals and native FFmpeg/FFprobe for independent verification.
- `npm run build`: passed with strict application TypeScript checking.
- `npm run test:browser`: **10/10 passed** against the production build, including all six supplied files, touch/resize, cancellation, accessibility, decoder fallback, exact AIFF region PCM, and subdirectory hosting with no external requests.

## Verification commands

```sh
npm run lint
npm test
npm run test:fixtures
npm run build
npm run test:browser
```

The engine suite also encodes every advertised output format, all offered sample rates with default codec settings, PCM bit depths, ADPCM variants, and VBR modes. It tests normalization, compression/limiting, source probing, audio-only extraction, marker round trips, actual-size enforcement, per-job progress, failure recovery, and cancellation.

## Remaining practical limits

Chromium desktop/mobile emulation was exercised. Safari, Firefox, physical mobile devices, assistive-technology listening/interaction, and live GitHub deployment were not verified. No BRSTM encoder was invoked; the checks establish source sample/marker preservation and valid exported audio/metadata, rather than claiming a separate BRSTM tool has accepted every output. Lossy codecs, resampling, DSP, and bit-depth reduction intentionally change samples. Unsupported complex sampler-loop modes are reported rather than silently converted to forward loops.
