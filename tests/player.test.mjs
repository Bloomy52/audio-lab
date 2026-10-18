import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioStudioPlayer } from "../src/utils/audioPlayer.ts";
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
class Context {
  currentTime = 0;
  state = "running";
  destination = {};
  closed = false;
  nodes = [];
  async resume() {}
  createGain() {
    return {
      gain: { value: 1, setTargetAtTime() {} },
      connect() {},
      disconnect() {},
    };
  }
  createBufferSource() {
    const s = {
      onended: null,
      start() {},
      stop() {},
      connect() {},
      disconnect() {},
    };
    this.nodes.push(s);
    return s;
  }
  async close() {
    this.closed = true;
  }
}
globalThis.AudioContext = Context;
test("disabling loop after playback has wrapped keeps actual position", async () => {
  const p = new AudioStudioPlayer();
  p.loadBuffer({ duration: 10 }, 2, 4);
  await p.play();
  const ctx = p.getContext();
  ctx.currentTime = 5;
  assert.equal(p.getCurrentTime(), 3);
  p.setLooping(false);
  await Promise.resolve();
  assert.equal(p.getCurrentTime(), 3);
  ctx.currentTime = 6;
  assert.equal(p.getCurrentTime(), 4);
  p.dispose();
  assert.equal(ctx.closed, true);
});
test("editing loop while playing rebases playback clock", async () => {
  const p = new AudioStudioPlayer();
  p.loadBuffer({ duration: 10 }, 2, 4);
  await p.play();
  p.getContext().currentTime = 5;
  assert.equal(p.getCurrentTime(), 3);
  p.setLoopPoints(6, 8);
  await Promise.resolve();
  assert.equal(p.getCurrentTime(), 3);
  p.getContext().currentTime = 6;
  assert.equal(p.getCurrentTime(), 4);
  p.pause();
  await p.play();
  assert.equal(p.getCurrentTime(), 4);
  p.dispose();
});
test("disposed pending playback cannot restart audio", async () => {
  const p = new AudioStudioPlayer();
  p.loadBuffer({ duration: 1 });
  const ctx = p.getContext();
  const pending = p.play();
  p.dispose();
  await pending;
  assert.equal(p.getIsPlaying(), false);
  assert.equal(ctx.nodes.length, 0);
});
