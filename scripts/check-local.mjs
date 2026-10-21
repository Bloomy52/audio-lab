import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const directory = resolve(process.argv[2]);
const server = spawn(process.execPath, [resolve(directory, "server.mjs")], {
  cwd: directory,
  env: { ...process.env, AUDIO_LAB_NO_OPEN: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
const exit = once(server, "exit");
let output = "";
server.stderr.on("data", (chunk) => { output += chunk; });
const timeout = setTimeout(() => server.kill("SIGKILL"), 20_000);
try {
  const url = await new Promise((resolveURL, reject) => {
    server.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) resolveURL(match[0]);
    });
    server.on("error", reject);
    server.on("exit", () => reject(new Error(`Server exited before startup: ${output}`)));
  });
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<html/);
  for (const [file, type] of [["ffmpeg-core.js", "text/javascript"], ["ffmpeg-core.wasm", "application/wasm"]]) {
    const response = await fetch(`${url}/ffmpeg/${file}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), new RegExp(type));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(resolve(directory, "app/ffmpeg", file)));
  }
  assert.equal((await fetch(`${url}/package.json`)).status, 404);
  assert.equal((await fetch(`${url}/%2e%2e%2fpackage.json`)).status, 403);
  assert.equal((await fetch(url, { method: "POST", body: "test" })).status, 405);
  console.log("Local release startup, assets, engine, and server boundaries passed.");
} finally {
  server.kill("SIGTERM");
  await exit;
  clearTimeout(timeout);
}
