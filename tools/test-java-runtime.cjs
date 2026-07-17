const assert = require("assert/strict");
const fsp = require("fs").promises;
const os = require("os");
const path = require("path");
const {
  applyRuntimeExecutablePermissions,
  findRuntimeJava,
  manifestJavaCandidates
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
    console.log("JAVA_RUNTIME_TEST_OK");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
