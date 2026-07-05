import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "build", "icon.png");
const iconset = path.join(root, "build", "icon.iconset");
const output = path.join(root, "build", "icon.icns");

if (process.platform !== "darwin") {
  throw new Error("macOS icon generation requires iconutil and must run on macOS.");
}

const entries = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024]
];

await fs.rm(iconset, { recursive: true, force: true });
await fs.mkdir(iconset, { recursive: true });

for (const [fileName, size] of entries) {
  await sharp(source)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3
    })
    .png()
    .toFile(path.join(iconset, fileName));
}

await execFileAsync("iconutil", ["-c", "icns", "-o", output, iconset]);
await fs.rm(iconset, { recursive: true, force: true });

console.log(`Created macOS ICNS: ${output}`);
