import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "build", "icon-source.png");
const outputPng = path.join(root, "build", "icon.png");
const outputIco = path.join(root, "build", "icon.ico");
const sizes = [16, 24, 32, 48, 64, 128, 256];

const image = sharp(source);
const metadata = await image.metadata();
if (!metadata.width || !metadata.height) {
  throw new Error("Unable to read the source icon dimensions.");
}

// Remove only the outer white canvas and retain the supplied brown background.
await image
  .trim({ background: "#ffffff", threshold: 10 })
  .resize(1024, 1024, {
    fit: "contain",
    position: "center",
    background: { r: 130, g: 62, b: 20, alpha: 1 },
    kernel: sharp.kernel.lanczos3
  })
  .png()
  .toFile(outputPng);

const temporaryFiles = [];
for (const size of sizes) {
  const file = path.join(root, "build", `.icon-${size}.png`);
  await sharp(outputPng).resize(size, size, { fit: "fill" }).png().toFile(file);
  temporaryFiles.push(file);
}

await fs.writeFile(outputIco, await pngToIco(temporaryFiles));
await Promise.all(temporaryFiles.map((file) => fs.rm(file, { force: true })));

console.log(`Created PNG icon: ${outputPng}`);
console.log(`Created Windows ICO: ${outputIco}`);
