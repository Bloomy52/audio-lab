export class AudioStudioPlayer {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private playing = false;
  private looping = true;
  private startTime = 0;
  private offset = 0;
  private loopStart = 0;
  private loopEnd = 0;
  private volume = 1;
  private epoch = 0;
  private frame: number | null = null;
  private timeCallback: ((time: number) => void) | null = null;
  private stateCallback: ((playing: boolean) => void) | null = null;
  getContext() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx;
  }
  onTimeUpdate(cb: (time: number) => void) {
    this.timeCallback = cb;
  }
  onStateChange(cb: (playing: boolean) => void) {
    this.stateCallback = cb;
  }
  loadBuffer(buffer: AudioBuffer, start = 0, end = buffer.duration) {
    this.stop();
    this.buffer = buffer;
    this.loopStart = start;
    this.loopEnd = end;
  }
  setLoopPoints(start: number, end: number) {
    if (
      !this.buffer ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end > this.buffer.duration ||
      end <= start
    )
      throw new Error("Invalid playback loop.");
    const was = this.playing;
    this.pause();
    this.loopStart = start;
    this.loopEnd = end;
    if (was) void this.play().catch(() => this.stop());
  }
  setLooping(enabled: boolean) {
    if (this.looping === enabled) return;
    const was = this.playing;
    this.pause();
    this.looping = enabled;
    if (was) void this.play().catch(() => this.stop());
  }
  setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.gain && this.ctx)
      this.gain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
  }
  async play(from?: number) {
    if (!this.buffer) return;
    const ctx = this.getContext();
    this.pause();
    const request = ++this.epoch;
    await ctx.resume();
    if (request !== this.epoch || !this.buffer) return;
    if (from !== undefined)
      this.offset = Math.max(0, Math.min(this.buffer.duration, from));
    if (
      this.offset >= this.buffer.duration ||
      (this.looping && this.offset >= this.loopEnd)
    )
      this.offset = this.looping ? this.loopStart : 0;
    const s = ctx.createBufferSource();
    s.buffer = this.buffer;
    s.loop = this.looping;
    s.loopStart = this.loopStart;
    s.loopEnd = this.loopEnd;
    s.connect(this.gain!);
    s.onended = () => {
      if (this.source === s) {
        this.stop();
      }
    };
    this.source = s;
    this.startTime = ctx.currentTime;
    s.start(0, this.offset);
    this.playing = true;
    this.stateCallback?.(true);
    this.track();
  }
  pause() {
    this.epoch++;
    if (!this.playing) return;
    this.offset = this.getCurrentTime();
    this.stopSource();
    this.playing = false;
    this.stateCallback?.(false);
    this.stopTracking();
  }
  stop() {
    this.epoch++;
    this.stopSource();
    this.playing = false;
    this.offset = 0;
    this.stopTracking();
    this.stateCallback?.(false);
    this.timeCallback?.(0);
  }
  async togglePlay() {
    if (this.playing) this.pause();
    else await this.play();
  }
  seek(time: number) {
    const was = this.playing;
    this.pause();
    this.offset = Math.max(0, Math.min(this.buffer?.duration ?? 0, time));
    this.timeCallback?.(this.offset);
    if (was) void this.play().catch(() => this.stop());
  }
  getCurrentTime() {
    if (!this.playing || !this.ctx) return this.offset;
    const t = this.offset + this.ctx.currentTime - this.startTime;
    if (!this.looping || t < this.loopEnd)
      return Math.min(this.buffer?.duration ?? 0, t);
    return (
      this.loopStart + ((t - this.loopEnd) % (this.loopEnd - this.loopStart))
    );
  }
  getIsPlaying() {
    return this.playing;
  }
  getIsLooping() {
    return this.looping;
  }
  private stopSource() {
    const s = this.source;
    this.source = null;
    if (s) {
      s.onended = null;
      try {
        s.stop();
      } catch {}
      s.disconnect();
    }
  }
  private stopTracking() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }
  private track() {
    this.stopTracking();
    const tick = () => {
      if (this.playing) {
        this.timeCallback?.(this.getCurrentTime());
        this.frame = requestAnimationFrame(tick);
      }
    };
    this.frame = requestAnimationFrame(tick);
  }
  dispose() {
    this.stop();
    this.buffer = null;
    this.timeCallback = null;
    this.stateCallback = null;
    this.gain?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
  }
}
