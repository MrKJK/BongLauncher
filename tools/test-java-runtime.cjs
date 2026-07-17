const assert = require("assert/strict");
const crypto = require("crypto");
const fsp = require("fs").promises;
const os = require("os");
const path = require("path");
const {
  applyRuntimeExecutablePermissions,
  findRuntimeJava,
  installTemurinRuntime,
  manifestJavaCandidates,
  parseJavaMajor,
  temurinMetadataUrl
} = require("../src/java-runtime.cjs");

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "bonglauncher-java-"));
  try {
    const relativeJava = "jre.bundle/Contents/Home/bin/java";
    const relativeHelper = "jre.bundle/Contents/Home/lib/jspawnhelper";
    const java = path.join(root, ...relativeJava.split("/"));
    const helper = path.join(root, ...relativeHelper.split("/"));
    await fsp.mkdir(path.dirname(java), { recursive: true });
    await fsp.mkdir(path.dirname(helper), { recursive: true });
    await fsp.writeFile(java, "java");
    await fsp.writeFile(helper, "helper");

    const manifest = {
      files: {
        [relativeJava]: { type: "file", executable: true },
        [relativeHelper]: { type: "file", executable: true },
        "../outside/bin/java": { type: "file", executable: true }
      }
    };

    assert.deepEqual(manifestJavaCandidates(root, "darwin", manifest), [java]);
    await applyRuntimeExecutablePermissions(root, "darwin", manifest);
    if (process.platform !== "win32") {
      assert.notEqual((await fsp.stat(java)).mode & 0o111, 0);
      assert.notEqual((await fsp.stat(helper)).mode & 0o111, 0);
    }

    const resolved = await findRuntimeJava({
      root,
      platform: "darwin",
      majorVersion: 21,
      manifest,
      resolveJava: async (candidate) => candidate === java ? { majorVersion: 21 } : undefined
    });
    assert.equal(resolved, java);

    assert.equal(parseJavaMajor('openjdk version "21.0.11" 2026-04-21 LTS'), 21);
    assert.equal(parseJavaMajor('java version "1.8.0_401"'), 8);
    assert.match(temurinMetadataUrl(21, "arm64"), /architecture=aarch64/);

    const archiveBytes = Buffer.from("temurin-test-archive");
    const checksum = crypto.createHash("sha256").update(archiveBytes).digest("hex");
    let request = 0;
    await installTemurinRuntime({
      root,
      majorVersion: 21,
      arch: "arm64",
      fetchImpl: async () => {
        request += 1;
        if (request === 1) {
          return {
            ok: true,
            json: async () => [{
              binary: {
                package: {
                  link: "https://example.test/temurin.tar.gz",
                  checksum,
                  size: archiveBytes.length
                }
              }
            }]
          };
        }
        return {
          ok: true,
          arrayBuffer: async () => archiveBytes.buffer.slice(
            archiveBytes.byteOffset,
            archiveBytes.byteOffset + archiveBytes.byteLength
          )
        };
      },
      extractArchive: async (archive, destination) => {
        assert.deepEqual(await fsp.readFile(archive), archiveBytes);
        await fsp.mkdir(path.join(destination, "Contents", "Home", "bin"), { recursive: true });
        await fsp.writeFile(path.join(destination, "Contents", "Home", "bin", "java"), "java");
      }
    });
    assert.equal(request, 2);
    assert.equal(await fsp.readFile(path.join(root, "Contents", "Home", "bin", "java"), "utf8"), "java");
    console.log("JAVA_RUNTIME_TEST_OK");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
