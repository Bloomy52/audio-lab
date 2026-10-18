import fs from "node:fs";
import createCore from "../public/ffmpeg/ffmpeg-core.js";
export class CoreAdapter {
  listeners = { log: new Set(), progress: new Set() };
  core = null;
  async load() {
    globalThis.self ??= {
      location: {
        href: new URL("../public/ffmpeg/ffmpeg-core.js", import.meta.url).href,
      },
    };
    this.core = await createCore({
      wasmBinary: fs.readFileSync(
        new URL("../public/ffmpeg/ffmpeg-core.wasm", import.meta.url),
      ),
    });
    this.core.setLogger((d) => this.listeners.log.forEach((cb) => cb(d)));
    this.core.setProgress((d) =>
      this.listeners.progress.forEach((cb) => cb(d)),
    );
  }
  on(event, cb) {
    this.listeners[event].add(cb);
  }
  off(event, cb) {
    this.listeners[event].delete(cb);
  }
  async exec(args, timeout) {
    this.core.setTimeout(timeout ?? 180000);
    const ret = this.core.exec(...args);
    this.core.reset();
    return ret;
  }
  async ffprobe(args, timeout) {
    this.core.setTimeout(timeout ?? 30000);
    const ret = this.core.ffprobe(...args);
    this.core.reset();
    return ret;
  }
  async writeFile(name, data) {
    const transferred = structuredClone(data, { transfer: [data.buffer] });
    this.core.FS.writeFile(name, transferred);
  }
  async readFile(name) {
    return this.core.FS.readFile(name);
  }
  async deleteFile(name) {
    this.core.FS.unlink(name);
  }
  terminate() {
    this.core = null;
  }
}
