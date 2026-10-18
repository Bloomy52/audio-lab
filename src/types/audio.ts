export type AudioFormat =
  | "wav"
  | "aiff"
  | "flac"
  | "mp3"
  | "ogg"
  | "opus"
  | "m4a"
  | "alac"
  | "aac"
  | "webm"
  | "wma"
  | "ac3"
  | "raw_pcm";
export type CompressionMode =
  | "target_size"
  | "lossy_vbr"
  | "lossy_cbr"
  | "flac_level"
  | "adpcm"
  | "uncompressed";
export type AdpcmType = "ima_wav" | "ms" | "yamaha";
/** All internal loop endpoints are exclusive, in source PCM frames. */
export interface LoopMetadata {
  loopStartSample: number;
  loopEndSample: number;
  loopLengthSamples: number;
  loopStartTimeSec: number;
  loopEndTimeSec: number;
  source?: "aiff_inst" | "wav_smpl" | "ogg_comment" | "flac_comment" | "user";
}
export interface DynamicRangeCompressorConfig {
  enabled: boolean;
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  makeupGainDb: number;
}
export interface AudioExportOptions {
  format: AudioFormat;
  compressionMode: CompressionMode;
  targetSizeMb?: number;
  bitrateKbps?: number;
  vbrQuality?: number;
  flacCompressionLevel?: number;
  adpcmType?: AdpcmType;
  sampleRate?: number;
  channels?: 1 | 2;
  bitDepth?: 16 | 24 | 32;
  normalizeLufs?: boolean;
  dynamicRangeCompressor?: DynamicRangeCompressorConfig;
  embedLoopMetadata?: boolean;
  audioStream?: number;
}
export interface AudioInfo {
  sampleRate: number;
  channels: number;
  duration: number;
  frames?: number;
  streams: { index: number; description: string }[];
  loop?: LoopMetadata;
  warnings: string[];
}
export interface LoadedAudioTrack {
  id: string;
  name: string;
  file: File;
  audioBuffer: AudioBuffer;
  duration: number;
  sampleRate: number;
  channels: number;
  detectedLoop?: LoopMetadata;
  info: AudioInfo;
}
export interface BatchQueueItem {
  id: string;
  file: File;
  name: string;
  sizeBytes: number;
  status: "pending" | "processing" | "completed" | "error" | "cancelled";
  progress: number;
  options: AudioExportOptions;
  streams?: AudioInfo["streams"];
  outputBlob?: Blob;
  outputFileName?: string;
  outputSizeBytes?: number;
  errorMessage?: string;
  warnings?: string[];
}
