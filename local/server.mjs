import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./app/", import.meta.url));
if (Number(process.versions.node.split(".")[0]) < 24) {
  console.error("Audio Lab requires Node.js 24 or newer. Install it from https://nodejs.org/");
  process.exit(1);
}
try {
  await access(resolve(root, "index.html"));
  await access(resolve(root, "ffmpeg/ffmpeg-core.wasm"));
  await access(resolve(root, "ffmpeg/ffmpeg-core.js"));
} catch {
  console.error("Audio Lab files are incomplete. Extract a complete Local Edition ZIP again.");
  process.exit(1);
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) {
      response.writeHead(403).end();
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      "Content-Length": info.size,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).on("error", () => response.destroy()).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});
server.on("error", (error) => {
  console.error(`Could not start Audio Lab: ${error.message}`);
  process.exitCode = 1;
});
server.listen(0, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(`Audio Lab: ${url}\nKeep this terminal open. Press Ctrl+C to stop.`);
  if (process.env.AUDIO_LAB_NO_OPEN === "1") return;
  const command = process.platform === "win32" ? "rundll32" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const browser = spawn(command, args, { stdio: "ignore" });
  browser.on("error", () => console.log(`Open ${url} in your browser.`));
  browser.on("exit", (code) => { if (code) console.log(`Open ${url} in your browser.`); });
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close();
    server.closeAllConnections();
  });
}
