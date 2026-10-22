# Bundled FFmpeg WebAssembly core

Audio Lab uses a custom single-thread audio-only FFmpeg 5.1.4 core, compiled
with Emscripten 3.1.61. The generated core reports LGPL 2.1 or later.
GPL and nonfree components are disabled. Linked external audio libraries are
LAME, Ogg, Vorbis, Opus, and zlib; their respective license terms also apply.
The JavaScript wrapper @ffmpeg/ffmpeg is a separate package.

- FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/n5.1.4
- WASM bindings source: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/f876f907c7e9b9bf51d4ed0b913a855a63ae63fc
- FFmpeg licensing: https://ffmpeg.org/legal.html
