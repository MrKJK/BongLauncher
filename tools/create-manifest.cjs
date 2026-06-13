const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const source = path.resolve(process.argv[2] || "pack");
const output = path.resolve(process.argv[3] || "manifest.json");
const baseUrl = (process.argv[4] || "https://example.com/launcher/files").replace(/\/$/, "");

async function walk(directory, root = directory) {
  const result = [];
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(absolute, root));
    if (entry.isFile()) result.push({ absolute, relative: path.relative(root, absolute).replaceAll("\\", "/") });
  }
  return result;
}

async function digest(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function main() {
  const files = [];
  for (const file of await walk(source)) {
    const stat = await fsp.stat(file.absolute);
    files.push({
      path: file.relative,
      url: `${baseUrl}/${file.relative.split("/").map(encodeURIComponent).join("/")}`,
      size: stat.size,
      sha256: await digest(file.absolute),
      required: true
    });
  }
  const manifest = {
    version: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    files
  };
  await fsp.writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`${files.length}개 파일의 manifest를 생성했습니다: ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
