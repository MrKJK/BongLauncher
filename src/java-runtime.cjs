const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

function executableName(platform) {
  return platform === "win32" ? "javaw.exe" : "java";
}

function resolveManifestPath(root, relative) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) return undefined;
  return resolved;
}

function manifestJavaCandidates(root, platform, manifest) {
  const executable = executableName(platform).toLowerCase();
  const candidates = [];
  for (const [relative, entry] of Object.entries(manifest?.files || {})) {
    const normalized = relative.replaceAll("\\", "/").toLowerCase();
    if (entry.type !== "file" || !normalized.endsWith(`/bin/${executable}`)) continue;
    const candidate = resolveManifestPath(root, relative);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

async function walkJavaCandidates(directory, executable, result) {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkJavaCandidates(absolute, executable, result);
    } else if (
      entry.isFile()
      && entry.name.toLowerCase() === executable
      && path.basename(path.dirname(absolute)).toLowerCase() === "bin"
    ) {
      result.push(absolute);
    }
  }
}

async function javaCandidates(root, platform, manifest) {
  const executable = executableName(platform);
  const candidates = [
    path.join(root, "bin", executable),
    path.join(root, "jre.bundle", "Contents", "Home", "bin", executable),
    ...manifestJavaCandidates(root, platform, manifest)
  ];
  await walkJavaCandidates(root, executable.toLowerCase(), candidates);
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

async function findRuntimeJava({ root, platform, majorVersion, resolveJava, manifest }) {
  for (const candidate of await javaCandidates(root, platform, manifest)) {
    try {
      const info = await resolveJava(candidate);
      if (Number(info?.majorVersion) === Number(majorVersion)) return candidate;
    } catch {
      // Try the next runtime layout when this candidate is absent or not executable.
    }
  }
  return undefined;
}

function parseJavaMajor(output) {
  const match = /(?:java|openjdk) version "(?:1\.)?(\d+)/i.exec(output)
    || /openjdk\s+(\d+)/i.exec(output);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

async function probeJava(executable) {
  const { stdout, stderr } = await execFileAsync(executable, ["-version"], {
    timeout: 15000,
    windowsHide: true
  });
  const output = `${stdout || ""}\n${stderr || ""}`;
  const majorVersion = parseJavaMajor(output);
  if (!majorVersion) throw new Error(`Java 버전을 확인할 수 없습니다: ${executable}`);
  return { path: executable, majorVersion };
}

async function applyRuntimeExecutablePermissions(root, platform, manifest) {
  if (platform === "win32") return;
  for (const [relative, entry] of Object.entries(manifest?.files || {})) {
    if (entry.type !== "file" || entry.executable !== true) continue;
    const absolute = resolveManifestPath(root, relative);
    if (!absolute) continue;
    const stat = await fsp.stat(absolute);
    await fsp.chmod(absolute, stat.mode | 0o111);
  }
}

function temurinArchitecture(arch) {
  return arch === "arm64" ? "aarch64" : "x64";
}

function temurinMetadataUrl(majorVersion, arch) {
  const query = new URLSearchParams({
    architecture: temurinArchitecture(arch),
    image_type: "jre",
    os: "mac",
    vendor: "eclipse"
  });
  return `https://api.adoptium.net/v3/assets/latest/${majorVersion}/hotspot?${query}`;
}

async function extractTarGz(archive, destination) {
  await execFileAsync("/usr/bin/tar", [
    "-xzf",
    archive,
    "-C",
    destination,
    "--strip-components=1"
  ], { timeout: 120000 });
}

async function installTemurinRuntime({
  root,
  majorVersion,
  arch,
  fetchImpl = fetch,
  extractArchive = extractTarGz,
  onProgress = () => {}
}) {
  const metadataResponse = await fetchImpl(temurinMetadataUrl(majorVersion, arch));
  if (!metadataResponse.ok) throw new Error(`Temurin 정보 요청 실패: HTTP ${metadataResponse.status}`);
  const releases = await metadataResponse.json();
  const packageInfo = releases?.[0]?.binary?.package;
  if (!packageInfo?.link || !packageInfo?.checksum) {
    throw new Error(`Temurin Java ${majorVersion} macOS 패키지를 찾지 못했습니다.`);
  }

  onProgress(10);
  const packageResponse = await fetchImpl(packageInfo.link);
  if (!packageResponse.ok) throw new Error(`Temurin 다운로드 실패: HTTP ${packageResponse.status}`);
  const bytes = Buffer.from(await packageResponse.arrayBuffer());
  if (packageInfo.size != null && bytes.length !== Number(packageInfo.size)) {
    throw new Error("Temurin 다운로드 크기가 일치하지 않습니다.");
  }
  const checksum = crypto.createHash("sha256").update(bytes).digest("hex");
  if (checksum !== String(packageInfo.checksum).toLowerCase()) {
    throw new Error("Temurin SHA-256 검증에 실패했습니다.");
  }

  onProgress(70);
  const archive = path.join(path.dirname(root), `.temurin-${process.pid}-${Date.now()}.tar.gz`);
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.mkdir(root, { recursive: true });
  try {
    await fsp.writeFile(archive, bytes);
    await extractArchive(archive, root);
  } finally {
    await fsp.rm(archive, { force: true });
  }
  onProgress(100);
}

module.exports = {
  applyRuntimeExecutablePermissions,
  findRuntimeJava,
  installTemurinRuntime,
  javaCandidates,
  manifestJavaCandidates,
  parseJavaMajor,
  probeJava,
  temurinMetadataUrl
};
