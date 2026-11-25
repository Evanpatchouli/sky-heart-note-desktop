import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const app = process.argv[2];
const dist = resolve("dist");
const manifest = JSON.parse(readFileSync(resolve(dist, "manifest.webmanifest"), "utf8"));
if (!["admin", "employee", "client"].includes(app) || manifest.id !== `/?app=${app}`) {
  throw new Error("应用与安装清单不匹配");
}

// Only Vite's hashed build output qualifies for precaching.
const assets = readdirSync(resolve(dist, "assets"), { withFileTypes: true })
  .filter(file => file.isFile() && /-[\w-]{8}\.[a-z\d]+$/i.test(file.name))
  .map(file => `assets/${file.name}`)
  .sort();
if (!assets.length) throw new Error("未找到可缓存的构建资源");

const worker = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const offlinePage = readFileSync(new URL("./offline.html", import.meta.url), "utf8")
  .replaceAll("%APP_NAME%", manifest.name)
  .replaceAll("%THEME_COLOR%", manifest.theme_color);
const releaseFiles = [
  "index.html", "manifest.webmanifest", "pwa/icon-180.png",
  ...manifest.icons.map(icon => icon.src.slice(1)), ...assets,
];
const revision = createHash("sha256").update(worker).update(offlinePage);
for (const file of releaseFiles) {
  revision.update(file).update(readFileSync(resolve(dist, file)));
}

const config = { app, version: revision.digest("hex").slice(0, 16), assets: assets.map(file => `/${file}`), offlinePage };
writeFileSync(resolve(dist, "service-worker.js"), `"use strict";\nconst config = ${JSON.stringify(config)};\n${worker}`);
