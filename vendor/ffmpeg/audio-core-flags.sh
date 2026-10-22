#!/usr/bin/env bash
# DRAFT, UNTESTED: audio-only FFmpeg configure flags for a custom @ffmpeg/core build.
#
# Intended to replace the component flags in the ffmpeg.wasm build script of your fork.
# Keep your fork's existing Emscripten/cross-compile flags (--target-os, --arch,
# --enable-cross-compile, --disable-asm, etc.) alongside these.
#
# Licensing guard rails: do NOT add --enable-gpl, --enable-nonfree, --enable-libx264,
# or --enable-libfdk_aac. Without them the build should be LGPL, not GPL.
# After building, run `ffmpeg -version` and confirm the license line and the
# "configuration:" line, then commit those flags to the repo.

FLAGS=(
  # ---- Start from nothing ----
  --disable-gpl
  --disable-nonfree
  --disable-everything
  --disable-autodetect
  --disable-doc
  --disable-network
  --disable-postproc
  --disable-programs        # fftools (ffmpeg, ffprobe) are compiled in a separate emcc step

  # ---- Libraries ----
  --enable-avutil
  --enable-avcodec
  --enable-avformat
  --enable-avfilter
  --enable-swresample

  # ---- External libraries (build each as a dependency first) ----
  # Verify each license when you set up the build:
  # libmp3lame (LGPL), libogg + libvorbis (BSD-style), libopus (BSD-style), zlib (zlib license)
  --enable-libmp3lame
  --enable-libvorbis
  --enable-libopus
  --enable-zlib             # some MOV and Matroska files use compressed headers

  # ---- I/O ----
  --enable-protocol=file

  # ---- Encoders (one per output format in FORMATS and codec()) ----
  --enable-encoder=pcm_s16le,pcm_s24le,pcm_s32le
  --enable-encoder=pcm_s16be,pcm_s24be,pcm_s32be
  --enable-encoder=pcm_f32le                       # decode fallback writes float WAV
  --enable-encoder=adpcm_ima_wav,adpcm_ms,adpcm_yamaha
  --enable-encoder=flac,alac,aac,ac3,wmav2
  --enable-encoder=libmp3lame,libvorbis,libopus

  # ---- Muxers (.m4a uses ipod; .aac uses adts; .raw uses s16le) ----
  --enable-muxer=wav,aiff,flac,ipod,mp3,ogg,opus,adts,webm,asf,ac3,pcm_s16le

  # ---- Demuxers (probing and decoding of accepted inputs) ----
  # matroska also covers WebM; mov also covers M4A and MP4
  --enable-demuxer=wav,aiff,flac,mp3,ogg,matroska,mov,aac,ac3,asf

  # ---- Parsers ----
  --enable-parser=aac,ac3,flac,mpegaudio,opus,vorbis

  # ---- Decoders ----
  --enable-decoder=pcm_s8,pcm_u8,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be
  --enable-decoder=pcm_s32le,pcm_s32be,pcm_f32le,pcm_f32be,pcm_f64le,pcm_f64be
  --enable-decoder=adpcm_ima_wav,adpcm_ms,adpcm_yamaha
  --enable-decoder=flac,mp3,mp3float,vorbis,opus,aac,alac,ac3
  --enable-decoder=wmav1,wmav2
  # Optional extras:
  #   --enable-decoder=wmapro,wmalossless   # more WMA variants
  #   --enable-decoder=mjpeg,png            # only if probing cover-art files logs errors

  # ---- Filters ----
  --enable-filter=acompressor,loudnorm,alimiter
  # The ffmpeg CLI needs these even though your code never names them.
  # If you hit "No such filter: X" at runtime, add X here.
  --enable-filter=abuffer,abuffersink,aformat,aresample,anull,atrim
)
