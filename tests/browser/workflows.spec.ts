import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { sine } from "../helpers.mjs";
import {
  createWavSmplChunk,
  injectLoopChunks,
  loopFromFrames,
  readAudioMetadata,
} from "../../src/utils/audioMetadata";
const payload = (name = "test.wav", seconds = 2) => ({
  name,
  mimeType: "audio/wav",
  buffer: Buffer.from(sine(seconds)),
});
async function openAudio(page: any, file = payload()) {
  await page.getByLabel("Studio audio file").setInputFiles(file);
  await expect(
    page.getByRole("button", { name: "Export & convert audio" }),
  ).toBeEnabled();
}
async function exportFile(page: any) {
  await page.getByRole("button", { name: "Export & convert audio" }).click();
  await expect(
    page.getByRole("link", { name: "Download rendered file" }),
  ).toBeVisible();
  const promise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download rendered file" }).click();
  const download = await promise;
  return fs.readFileSync(await download.path());
}
test("load, frame edit, export metadata, stale result, tab persistence and accessible help", async ({
  page,
}) => {
  const exceptions: string[] = [];
  page.on("pageerror", (e) => exceptions.push(e.message));
  await page.goto("/");
  await openAudio(page);
  await page
    .getByRole("spinbutton", { name: "Loop start frame", exact: true })
    .fill("4800");
  await page
    .getByRole("spinbutton", { name: "Loop start frame", exact: true })
    .press("Tab");
  await expect(
    page.getByRole("spinbutton", { name: "Loop start frame", exact: true }),
  ).toHaveValue("4800");
  const bytes = await exportFile(page);
  const meta = readAudioMetadata(bytes);
  expect(meta.sampleRate).toBe(48000);
  expect(meta.loop?.loopStartSample).toBe(4800);
  expect(meta.loop?.loopEndSample).toBe(96000);
  await page
    .getByRole("spinbutton", { name: "Loop start frame", exact: true })
    .fill("5000");
  await page
    .getByRole("spinbutton", { name: "Loop start frame", exact: true })
    .press("Tab");
  await expect(
    page.getByRole("heading", { name: /Previous rendered output/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Batch converter", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Loop & edit studio", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Loop start frame", exact: true }),
  ).toHaveValue("5000");
  await page.getByRole("button", { name: "Help & shortcuts" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(exceptions).toEqual([]);
  const screenshots = new URL("../../artifacts/screenshots/", import.meta.url);
  fs.mkdirSync(screenshots, { recursive: true });
  await page.screenshot({
    path: new URL("studio.png", screenshots).pathname,
    fullPage: true,
  });
});
test("batch keeps rows/results across tabs and ZIP names do not collide", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Batch converter", exact: true })
    .click();
  const section = page.getByRole("region", {
    name: "Batch converter",
    exact: true,
  });
  await page
    .getByLabel("Batch audio files")
    .setInputFiles([payload("same.wav"), payload("same.aiff")]);
  await section
    .getByRole("button", { name: "Convert pending / retry failed" })
    .click();
  await expect(
    section.getByRole("button", { name: "Download completed as ZIP" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Loop & edit studio", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Batch converter", exact: true })
    .click();
  await expect(
    section.getByText("same (2).mp3", { exact: false }).first(),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await section
    .getByRole("button", { name: "Download completed as ZIP" })
    .click();
  const download = await downloadPromise;
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
  expect(Object.keys(zip.files)).toEqual(["same.mp3", "same (2).mp3"]);
});
test("trusted fixture files load with their source rates and original frame markers", async ({
  page,
}) => {
  const path = new URL("../fixtures.local.json", import.meta.url);
  test.skip(!fs.existsSync(path), "Local private fixture manifest is optional");
  const fixtures = JSON.parse(fs.readFileSync(path, "utf8"));
  await page.goto("/");
  for (const fixture of fixtures) {
    await page.getByLabel("Studio audio file").setInputFiles(fixture.path);
    await expect(
      page.getByRole("heading", {
        name: fixture.path.split("/").pop(),
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Export & convert audio" }),
    ).toBeEnabled();
    const start = page.getByRole("spinbutton", {
      name: "Loop start frame",
      exact: true,
    });
    expect(await start.inputValue()).toBe(String(fixture.loopStart ?? 0));
    if (fixture.loopEnd)
      await expect(
        page.getByRole("spinbutton", { name: "Loop end frame", exact: true }),
      ).toHaveValue(String(fixture.loopEnd));
    const bytes = await exportFile(page);
    expect(readAudioMetadata(bytes).sampleRate).toBe(fixture.rate);
  }
});
test("touch can drag markers, resize redraws, region export uses worker and true length", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  await openAudio(page);
  const canvas = page.getByRole("img", { name: /Audio waveform/ });
  await page.setViewportSize({ width: 430, height: 844 });
  await expect
    .poll(() =>
      canvas.evaluate(
        (el) =>
          el.width ===
          Math.round(el.getBoundingClientRect().width * devicePixelRatio),
      ),
    )
    .toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await canvas.scrollIntoViewIfNeeded();
  const rect = (await canvas.boundingBox())!;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: rect.x + rect.width - 2, y: rect.y + 100 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: rect.x + rect.width * 0.7, y: rect.y + 100 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  expect(
    Number(
      await page
        .getByRole("spinbutton", { name: "Loop end frame", exact: true })
        .inputValue(),
    ),
  ).toBeLessThan(96000);
  await page
    .getByRole("combobox", { name: "Content", exact: true })
    .selectOption("region");
  await page.getByRole("slider", { name: "Overlap crossfade (ms)" }).fill("25");
  const end = Number(
    await page
      .getByRole("spinbutton", { name: "Loop end frame", exact: true })
      .inputValue(),
  );
  await page
    .getByRole("slider", { name: "Overlap crossfade (ms)" })
    .press("Tab");
  const exportButton = page.getByRole("button", {
    name: "Export & convert audio",
  });
  await exportButton.scrollIntoViewIfNeeded();

  await exportButton.tap();
  const link = page.getByRole("link", { name: "Download rendered file" });
  await expect(link).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await link.tap();
  const download = await downloadPromise;
  const bytes = fs.readFileSync(await download.path());
  expect(readAudioMetadata(bytes).frames).toBe(end - 1200);
  await context.close();
});
test("cancellation releases controls and the engine recovers for the next conversion", async ({
  page,
}) => {
  await page.goto("/");
  await openAudio(page, payload("cancel.wav", 15));
  await page.getByRole("button", { name: "Export & convert audio" }).click();
  await page.getByRole("button", { name: "Cancel operation" }).click();
  await expect(
    page.getByRole("button", { name: "Export & convert audio" }),
  ).toBeEnabled();
  await expect(page.getByRole("alert")).toContainText("cancelled");
  const bytes = await exportFile(page);
  expect(readAudioMetadata(bytes).frames).toBe(15 * 48000);
});
test("imported WAV marker fixture is restored exactly without automatic snapping", async ({
  page,
}) => {
  const bytes = injectLoopChunks(
    sine(2),
    "wav",
    loopFromFrames(123, 90001, 48000),
    48000,
  );
  await page.goto("/");
  await openAudio(page, {
    name: "markers.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from(bytes),
  });
  await expect(
    page.getByRole("spinbutton", { name: "Loop start frame", exact: true }),
  ).toHaveValue("123");
  await expect(
    page.getByRole("spinbutton", { name: "Loop end frame", exact: true }),
  ).toHaveValue("90001");
  const out = readAudioMetadata(await exportFile(page));
  expect(out.loop?.loopStartSample).toBe(123);
  expect(out.loop?.loopEndSample).toBe(90001);
  expect(createWavSmplChunk(123, 90001).length).toBe(68);
});

test("studio, batch and help have no serious automated accessibility violations", async ({
  page,
}) => {
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  await page.goto("/");
  await openAudio(page);
  let results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
  await page.getByRole("button", { name: "Help & shortcuts" }).click();
  results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Batch converter", exact: true })
    .click();
  results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
});

test("native decoder failure falls back to the local engine at the source rate", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const native = OfflineAudioContext.prototype.decodeAudioData;
    let first = true;
    OfflineAudioContext.prototype.decodeAudioData = function (
      data: ArrayBuffer,
    ) {
      if (first) {
        first = false;
        return Promise.reject(
          new DOMException(
            "Simulated unsupported browser codec",
            "EncodingError",
          ),
        );
      }
      return native.call(this, data);
    } as typeof native;
  });
  await page.goto("/");
  await openAudio(page, {
    name: "fallback.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from(sine(1, 44100)),
  });
  await page
    .getByRole("combobox", { name: "Content", exact: true })
    .selectOption("region");
  const bytes = await exportFile(page);
  expect(readAudioMetadata(bytes).sampleRate).toBe(44100);
  expect(readAudioMetadata(bytes).frames).toBe(44100);
});
test("trusted AIFF loop-region export has exactly the original selected PCM", async ({
  page,
}) => {
  const manifest = new URL("../fixtures.local.json", import.meta.url);
  test.skip(!fs.existsSync(manifest), "Private fixtures are optional");
  const fixture = JSON.parse(fs.readFileSync(manifest, "utf8")).find(
    (f: any) => f.name === "aiff-looped",
  );
  await page.goto("/");
  await page.getByLabel("Studio audio file").setInputFiles(fixture.path);
  await expect(
    page.getByRole("button", { name: "Export & convert audio" }),
  ).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Content", exact: true })
    .selectOption("region");
  const bytes = await exportFile(page);
  const meta = readAudioMetadata(bytes);
  expect(meta.frames).toBe(fixture.loopEnd - fixture.loopStart);
  expect(meta.loop?.loopStartSample).toBe(0);
  expect(meta.loop?.loopEndSample).toBe(meta.frames);
  const dir = new URL("../../artifacts/fixture-tests/", import.meta.url);
  fs.mkdirSync(dir, { recursive: true });
  const out = new URL("browser-aiff-region.wav", dir);
  fs.writeFileSync(out, bytes);
  const { execFileSync } = await import("node:child_process");
  const expected = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      fixture.path,
      "-map",
      "0:a:0",
      "-af",
      `atrim=start_sample=${fixture.loopStart}:end_sample=${fixture.loopEnd}`,
      "-f",
      "hash",
      "-hash",
      "sha256",
      "-",
    ],
    { encoding: "utf8" },
  );
  const actual = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      out.pathname,
      "-map",
      "0:a:0",
      "-f",
      "hash",
      "-hash",
      "sha256",
      "-",
    ],
    { encoding: "utf8" },
  );
  expect(actual).toBe(expected);
});

test("built site works from a GitHub Pages-style subdirectory without external requests", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const requests: string[] = [];
  context.on("request", (request) => {
    requests.push(request.url());
    expect(request.method()).toBe("GET");
  });
  await context.route("**/audio-lab/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const file = pathname.slice("/audio-lab/".length) || "index.html";
    const base = new URL("../../dist/", import.meta.url);
    const contentType = file.endsWith(".js")
      ? "application/javascript"
      : file.endsWith(".css")
        ? "text/css"
        : file.endsWith(".wasm")
          ? "application/wasm"
          : file.endsWith(".svg")
            ? "image/svg+xml"
            : "text/html";
    await route.fulfill({
      body: fs.readFileSync(new URL(file, base)),
      contentType,
    });
  });
  const page = await context.newPage();
  await page.goto("/audio-lab/");
  await openAudio(page);
  const bytes = await exportFile(page);
  expect(readAudioMetadata(bytes).frames).toBe(96000);
  expect(
    requests.every((url) => new URL(url).origin === "http://127.0.0.1:4173"),
  ).toBe(true);
  await context.close();
});
