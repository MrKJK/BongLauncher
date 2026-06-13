const fsp = require("fs").promises;
const path = require("path");

const root = path.resolve(__dirname, "..");
const owner = process.argv[2];
const repo = process.argv[3] || "BongLauncher";

if (!owner) {
  console.error("사용법: npm run github:configure -- <GitHub사용자명> [저장소명]");
  process.exit(1);
}

const baseUrl = `https://${owner}.github.io/${repo}`;

async function updateJson(relativePath, update) {
  const file = path.join(root, relativePath);
  const value = JSON.parse(await fsp.readFile(file, "utf8"));
  update(value);
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  await updateJson("launcher-config.json", (value) => {
    value.updates.provider = "github";
    value.updates.owner = owner;
    value.updates.repo = repo;
    value.updates.remoteConfigUrl = `${baseUrl}/launcher-config.json`;
  });
  await updateJson("remote-config.example.json", (value) => {
    value.distribution.manifestUrl = `${baseUrl}/files/manifest.json`;
  });
  await updateJson("pages/launcher-config.json", (value) => {
    value.distribution.manifestUrl = `${baseUrl}/files/manifest.json`;
  });
  await updateJson("package.json", (value) => {
    value.build.publish = {
      provider: "github",
      owner,
      repo
    };
    value.repository = {
      type: "git",
      url: `https://github.com/${owner}/${repo}.git`
    };
    value.homepage = baseUrl;
  });
  console.log(`GitHub 설정 완료: https://github.com/${owner}/${repo}`);
  console.log(`GitHub Pages: ${baseUrl}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
