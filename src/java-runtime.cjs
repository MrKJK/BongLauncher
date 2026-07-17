const fsp = require("fs").promises;
const path = require("path");

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

module.exports = {
  applyRuntimeExecutablePermissions,
  findRuntimeJava,
  javaCandidates,
  manifestJavaCandidates
};
