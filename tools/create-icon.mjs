import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "build", "icon-source.png");
const outputPng = path.join(root, "build", "icon.png");
const outputIco = path.join(root, "build", "icon.ico");
const sizes = [16, 24, 32, 48, 64, 128, 256];

const image = sharp(source).ensureAlpha();
const metadata = await image.metadata();
if (!metadata.width || !metadata.height) {
  throw new Error("Unable to read the source icon dimensions.");
}

// Crop the mascot's face so the wordmark stays out and small icons remain clear.
const mascot = {
  left: Math.round(metadata.width * 0.345),
  top: Math.round(metadata.height * 0.205),
  width: Math.round(metadata.width * 0.31),
  height: Math.round(metadata.height * 0.235)
};

const { data, info } = await image
  .extract(mascot)
  .raw()
  .toBuffer({ resolveWithObject: true });

for (let index = 0; index < data.length; index += info.channels) {
  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  const originalAlpha = data[index + 3];
  const distanceFromWhite = Math.max(255 - red, 255 - green, 255 - blue);

  if (distanceFromWhite <= 8) {
    data[index + 3] = 0;
  } else if (distanceFromWhite < 40) {
    data[index + 3] = Math.round(originalAlpha * ((distanceFromWhite - 8) / 32));
  }
}

const iconSize = 896;
const circleMask = Buffer.from(
  `<svg width="${iconSize}" height="${iconSize}">
    <circle cx="${iconSize / 2}" cy="${iconSize / 2}" r="${iconSize / 2}" fill="white"/>
  </svg>`
);

await sharp(data, { raw: info })
  .resize(iconSize, iconSize, {
    fit: "cover",
    position: "centre",
    kernel: sharp.kernel.lanczos3
  })
  .composite([{ input: circleMask, blend: "dest-in" }])
  .extend({
    top: 64,
    bottom: 64,
    left: 64,
    right: 64,
    background: { r: 0, g: 0, b: 0, alpha: 0 }
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
