import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import JSZip from "jszip";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const tag = process.argv[2] ?? `v${manifest.version}`;
if (!/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
  throw new Error("Release tag must be a version such as v1.2.3 or v1.2.3-beta.1");
}
const version = tag.replace(/^v/, "");
const zip = new JSZip();
const folder = zip.folder("audio-lab-local");
async function addTree(source, destination, exclude = () => false) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (exclude(entry.name)) continue;
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), source);
    if (entry.isDirectory()) await addTree(url, destination.folder(entry.name), exclude);
    else if (entry.isFile()) destination.file(entry.name, await readFile(url));
  }
}
await addTree(new URL("dist/", root), folder.folder("app"));
await addTree(new URL("local/", root), folder, (name) =>
  ["node_modules", "app", "package.json", "package-lock.json"].includes(name));
for (const name of ["package.json", "package-lock.json"]) {
  const data = JSON.parse(await readFile(new URL(`local/${name}`, root), "utf8"));
  data.version = version;
  if (data.packages) data.packages[""].version = version;
  folder.file(name, JSON.stringify(data, null, 2) + "\n");
}
await mkdir(new URL("artifacts/", root), { recursive: true });
const target = new URL(`artifacts/audio-lab-local-${tag}.zip`, root);
await writeFile(target, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
console.log(`Created ${target.pathname}`);
