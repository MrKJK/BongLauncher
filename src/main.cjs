const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog } = require("electron");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const net = require("net");
const http = require("http");
const os = require("os");
const { autoUpdater } = require("electron-updater");

let mainWindow;
let config;
let paths;
let account;
let currentManifest;

function configPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "launcher-config.json")
    : path.join(__dirname, "..", "launcher-config.json");
}

function sendProgress(message, percent = 0, detail = "") {
  mainWindow?.webContents.send("progress", { message, percent, detail });
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function updateLauncherState(patch) {
  const current = await readJson(paths.state, {});
  const next = mergeObject(current || {}, patch);
  await writeJson(paths.state, next);
  return next;
}

function memoryLimitMb() {
  const totalMb = Math.floor(os.totalmem() / 1024 / 1024);
  return Math.max(2048, Math.min(32768, totalMb - 1024));
}

function applyLauncherState(state = {}) {
  if (typeof state.autoConnect === "boolean") config.server.autoConnect = state.autoConnect;
  const maxMemoryMb = Number(state.memory?.maxMemoryMb);
  if (Number.isFinite(maxMemoryMb)) {
    config.minecraft.maxMemoryMb = Math.max(1024, Math.min(memoryLimitMb(), Math.round(maxMemoryMb)));
  }
}

function setupPaths() {
  const root = path.join(app.getPath("appData"), config.launcherName);
  paths = {
    root,
    game: path.join(root, "game"),
    runtime: path.join(root, "runtime"),
    state: path.join(root, "launcher-state.json"),
    account: path.join(root, "account.bin"),
    manifest: path.join(root, "manifest.json"),
    remoteConfig: path.join(root, "remote-config.json"),
    gameOptionsState: path.join(root, "game-options-state.json"),
    onceFilesState: path.join(root, "once-files-state.json"),
    session: path.join(root, "game", ".launcher", "session.json")
  };
}

function mergeObject(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) return base;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && base?.[key]
      && typeof base[key] === "object"
      && !Array.isArray(base[key])
    ) {
      result[key] = mergeObject(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function applyRemoteConfig(base, remote) {
  const allowed = ["notice", "server", "minecraft", "distribution", "gameOptions", "security"];
  const sanitized = {};
  for (const key of allowed) {
    if (remote?.[key] && typeof remote[key] === "object") sanitized[key] = remote[key];
  }
  return mergeObject(base, sanitized);
}

async function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchJson(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function loadRuntimeConfig() {
  const local = await readJson(configPath());
  const url = local.updates?.remoteConfigUrl;
  if (!url) return local;
  try {
    const remote = await fetchWithTimeout(url);
    await writeJson(paths.remoteConfig, remote);
    return applyRemoteConfig(local, remote);
  } catch (error) {
    const cached = await readJson(paths.remoteConfig);
    if (cached) return applyRemoteConfig(local, cached);
    console.warn(`Remote config unavailable: ${error.message}`);
    return local;
  }
}

function configureAutoUpdater() {
  if (!app.isPackaged || !config.updates?.enabled || !config.updates?.checkOnStart) return;
  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    sendProgress("포터블 버전은 자동 설치를 지원하지 않습니다.", 0);
    return;
  }
  const provider = config.updates.provider || "generic";
  const owner = config.updates.owner;
  const repo = config.updates.repo;
  const feedUrl = config.updates.feedUrl;
  if (provider === "github") {
    if (!owner || owner.includes("YOUR_") || !repo) {
      console.warn("GitHub auto update owner/repo is not configured.");
      return;
    }
  } else if (!feedUrl) {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.setFeedURL(
    provider === "github"
      ? { provider: "github", owner, repo }
      : { provider: "generic", url: feedUrl }
  );
  autoUpdater.on("checking-for-update", () => {
    sendProgress("런처 업데이트를 확인하고 있습니다.", 0);
  });
  autoUpdater.on("update-available", (info) => {
    sendProgress(`런처 ${info.version} 업데이트를 다운로드합니다.`, 0);
  });
  autoUpdater.on("download-progress", (progress) => {
    sendProgress(
      `런처 업데이트 다운로드 중 ${Math.round(progress.percent)}%`,
      Math.round(progress.percent)
    );
  });
  autoUpdater.on("update-not-available", () => {
    sendProgress("최신 런처 버전입니다.", 0);
  });
  autoUpdater.on("error", (error) => {
    console.warn(`Auto update failed: ${error.message}`);
    sendProgress("런처 업데이트 확인에 실패했습니다. 현재 버전으로 계속합니다.", 0);
  });
  autoUpdater.on("update-downloaded", async (info) => {
    sendProgress(`런처 ${info.version} 업데이트 준비 완료`, 100);
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "BongLauncher 업데이트",
      message: `BongLauncher ${info.version} 업데이트가 준비되었습니다.`,
      detail: "지금 재시작하면 새 버전이 자동으로 설치됩니다.",
      buttons: ["지금 재시작", "종료할 때 설치"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (result.response === 0) autoUpdater.quitAndInstall(false, true);
  });
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      console.warn(`Update check failed: ${error.message}`);
    });
  }, 1500);
}

async function loadAccount() {
  try {
    const encrypted = await fsp.readFile(paths.account);
    if (!safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(safeStorage.decryptString(encrypted));
  } catch {
    return null;
  }
}

async function saveAccount(value) {
  account = value;
  if (!value) {
    await fsp.rm(paths.account, { force: true });
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows 보안 저장소를 사용할 수 없습니다.");
  }
  await fsp.mkdir(paths.root, { recursive: true });
  await fsp.writeFile(paths.account, safeStorage.encryptString(JSON.stringify(value)));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

function formBody(values) {
  return new URLSearchParams(values).toString();
}

function validateMicrosoftClientId() {
  const clientId = config.microsoft.clientId;
  if (!clientId || clientId.includes("YOUR_")) {
    throw new Error("launcher-config.json에 Microsoft Entra clientId를 먼저 설정해야 합니다.");
  }
  return clientId;
}

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function loginWithBrowser() {
  const clientId = validateMicrosoftClientId();
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64Url(crypto.randomBytes(24));
  const scope = "XboxLive.signin offline_access";

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
      if (error) reject(error);
      else resolve(value);
    };

    const server = http.createServer(async (request, response) => {
      try {
        const callback = new URL(request.url, "http://localhost");
        if (callback.pathname !== "/") {
          response.writeHead(404).end();
          return;
        }
        if (callback.searchParams.get("state") !== state) {
          throw new Error("Microsoft 로그인 상태 검증에 실패했습니다.");
        }
        const oauthError = callback.searchParams.get("error");
        if (oauthError) {
          throw new Error(callback.searchParams.get("error_description") || oauthError);
        }
        const code = callback.searchParams.get("code");
        if (!code) throw new Error("Microsoft 인증 코드가 반환되지 않았습니다.");

        const address = server.address();
        const redirectUri = `http://localhost:${address.port}`;
        const oauth = await fetchJson("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: formBody({
            client_id: clientId,
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            code_verifier: verifier,
            scope
          })
        });
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store"
        });
        response.end(`<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><title>로그인 완료</title></head>
<body style="font-family:Segoe UI,Malgun Gothic,sans-serif;background:#07110e;color:#fff;display:grid;place-items:center;height:100vh;margin:0">
  <main style="text-align:center"><h1>로그인이 완료되었습니다</h1><p>이 창을 닫고 런처로 돌아가세요.</p></main>
</body>
</html>`);
        finish(null, oauth);
      } catch (error) {
        response.writeHead(400, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store"
        });
        response.end("<h1>로그인에 실패했습니다.</h1><p>런처로 돌아가 다시 시도해 주세요.</p>");
        finish(error);
      }
    });

    server.on("error", (error) => finish(error));
    server.listen(0, "127.0.0.1", async () => {
      try {
        const address = server.address();
        const redirectUri = `http://localhost:${address.port}`;
        const authorize = new URL("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize");
        authorize.search = new URLSearchParams({
          client_id: clientId,
          response_type: "code",
          redirect_uri: redirectUri,
          response_mode: "query",
          scope,
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
          prompt: "select_account"
        }).toString();
        sendProgress("브라우저에서 Microsoft 계정을 선택해 주세요.", 0);
        await shell.openExternal(authorize.toString());
      } catch (error) {
        finish(error);
      }
    });

    const timeout = setTimeout(() => {
      finish(new Error("Microsoft 로그인 시간이 만료되었습니다."));
    }, 5 * 60 * 1000);
  });
}

async function exchangeMinecraftAccount(oauth) {
  const { MicrosoftAuthenticator, MojangClient } = require("@xmcl/user");
  const authenticator = new MicrosoftAuthenticator({});
  const xbox = await authenticator.acquireXBoxToken(oauth.access_token);
  const claim = xbox.minecraftXstsResponse.DisplayClaims.xui[0];
  const minecraftAuth = await authenticator.loginMinecraftWithXBox(
    claim.uhs,
    xbox.minecraftXstsResponse.Token
  );
  const mojang = new MojangClient();
  const ownership = await mojang.checkGameOwnership(minecraftAuth.access_token);
  if (!ownership.items?.length) throw new Error("이 Microsoft 계정은 Minecraft Java Edition을 소유하지 않았습니다.");
  const profile = await mojang.getProfile(minecraftAuth.access_token);
  return {
    id: profile.id,
    name: profile.name,
    accessToken: minecraftAuth.access_token,
    minecraftExpiresAt: Date.now() + minecraftAuth.expires_in * 1000,
    refreshToken: oauth.refresh_token,
    oauthExpiresAt: Date.now() + oauth.expires_in * 1000
  };
}

async function refreshAccount() {
  if (!account?.refreshToken) throw new Error("Microsoft 로그인이 필요합니다.");
  if (account.minecraftExpiresAt > Date.now() + 60_000) return account;
  const oauth = await fetchJson("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formBody({
      client_id: config.microsoft.clientId,
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
      scope: "XboxLive.signin offline_access"
    })
  });
  const refreshed = await exchangeMinecraftAccount(oauth);
  await saveAccount(refreshed);
  return refreshed;
}

function textComponentToString(value) {
  if (typeof value === "string") return value.replace(/§[0-9A-FK-OR]/gi, "");
  if (!value) return "";
  const own = value.text || value.translate || "";
  const extra = Array.isArray(value.extra) ? value.extra.map(textComponentToString).join("") : "";
  return `${own}${extra}`.replace(/§[0-9A-FK-OR]/gi, "");
}

function encodeVarInt(value) {
  const bytes = [];
  let current = value >>> 0;
  do {
    let byte = current & 0x7f;
    current >>>= 7;
    if (current !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (current !== 0);
  return Buffer.from(bytes);
}

function decodeVarInt(buffer, offset = 0) {
  let value = 0;
  let position = 0;
  let cursor = offset;
  while (cursor < buffer.length) {
    const byte = buffer[cursor++];
    value |= (byte & 0x7f) << position;
    if ((byte & 0x80) === 0) return { value, bytes: cursor - offset };
    position += 7;
    if (position >= 35) throw new Error("잘못된 Minecraft VarInt");
  }
  return null;
}

function minecraftString(value) {
  const content = Buffer.from(value, "utf8");
  return Buffer.concat([encodeVarInt(content.length), content]);
}

function packet(payload) {
  return Buffer.concat([encodeVarInt(payload.length), payload]);
}

async function queryMinecraftStatus(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const started = Date.now();
    let received = Buffer.alloc(0);
    const timeout = setTimeout(() => socket.destroy(new Error("서버 응답 시간 초과")), 5000);

    socket.on("connect", () => {
      const portBuffer = Buffer.alloc(2);
      portBuffer.writeUInt16BE(port);
      const handshake = Buffer.concat([
        encodeVarInt(0),
        encodeVarInt(-1),
        minecraftString(host),
        portBuffer,
        encodeVarInt(1)
      ]);
      socket.write(packet(handshake));
      socket.write(packet(encodeVarInt(0)));
    });
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      const packetLength = decodeVarInt(received);
      if (!packetLength || received.length < packetLength.bytes + packetLength.value) return;
      let cursor = packetLength.bytes;
      const packetId = decodeVarInt(received, cursor);
      if (!packetId || packetId.value !== 0) return;
      cursor += packetId.bytes;
      const stringLength = decodeVarInt(received, cursor);
      if (!stringLength || received.length < cursor + stringLength.bytes + stringLength.value) return;
      cursor += stringLength.bytes;
      try {
        const status = JSON.parse(received.subarray(cursor, cursor + stringLength.value).toString("utf8"));
        clearTimeout(timeout);
        socket.end();
        resolve({ ...status, ping: Date.now() - started });
      } catch (error) {
        socket.destroy(error);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function queryServer() {
  try {
    const status = await queryMinecraftStatus(config.server.host, config.server.port);
    return {
      online: true,
      name: config.server.name,
      motd: textComponentToString(status.description),
      players: status.players,
      ping: Math.round(status.ping),
      version: status.version
    };
  } catch (error) {
    return { online: false, name: config.server.name, error: error.message };
  }
}

async function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function normalizeRelative(value) {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("../") || path.isAbsolute(normalized)) {
    throw new Error(`허용되지 않는 파일 경로: ${value}`);
  }
  return normalized;
}

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("**", ".*").replaceAll("*", "[^/]*")}$`, "i");
}

function isIgnored(relative) {
  return config.distribution.ignoredFiles.some((pattern) => wildcardToRegExp(pattern).test(relative));
}

function isOnceFile(relative) {
  const patterns = Array.isArray(config.distribution.onceFiles) ? config.distribution.onceFiles : [];
  return patterns.some((pattern) => wildcardToRegExp(pattern).test(relative));
}

function onceFileFingerprint(item) {
  return item.sha256?.toLowerCase() || crypto
    .createHash("sha256")
    .update(JSON.stringify({
      path: normalizeRelative(item.path),
      url: item.url,
      size: item.size
    }))
    .digest("hex");
}

async function walkFiles(directory, root = directory) {
  const result = [];
  let entries = [];
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return result;
    throw error;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walkFiles(absolute, root));
    if (entry.isFile()) result.push(path.relative(root, absolute).replaceAll("\\", "/"));
  }
  return result;
}

async function getManifest(forceRemote = false) {
  if (!forceRemote && currentManifest) return currentManifest;
  const url = config.distribution.manifestUrl;
  if (!url || url.includes("example.com")) {
    currentManifest = await readJson(paths.manifest, { version: "local", files: [] });
    return currentManifest;
  }
  currentManifest = await fetchJson(url, { cache: "no-store" });
  if (!Array.isArray(currentManifest.files)) throw new Error("배포 manifest.json의 files 배열이 없습니다.");
  await writeJson(paths.manifest, currentManifest);
  return currentManifest;
}

async function verifyFiles(manifest) {
  manifest = manifest || await getManifest();
  const problems = [];
  const expected = new Map();
  for (const item of manifest.files) {
    const relative = normalizeRelative(item.path);
    expected.set(relative.toLowerCase(), item);
    const absolute = path.join(paths.game, relative);
    const applyOnce = isOnceFile(relative);
    try {
      const stat = await fsp.stat(absolute);
      if (!stat.isFile()) throw new Error("not-file");
      if (applyOnce) continue;
      if (item.size != null && stat.size !== item.size) {
        problems.push(`${relative}: 크기 불일치`);
      } else if (item.sha256 && await sha256(absolute) !== item.sha256.toLowerCase()) {
        problems.push(`${relative}: 해시 불일치`);
      }
    } catch {
      if (item.required !== false) problems.push(`${relative}: 없음`);
    }
  }
  if (config.distribution.strictMode) {
    for (const directory of config.distribution.watchDirectories) {
      const absoluteDirectory = path.join(paths.game, normalizeRelative(directory));
      for (const child of await walkFiles(absoluteDirectory, paths.game)) {
        const relative = child.replaceAll("\\", "/");
        if (!expected.has(relative.toLowerCase()) && !isIgnored(relative)) {
          problems.push(`${relative}: 허용되지 않은 파일`);
        }
      }
    }
  }
  return { valid: problems.length === 0, problems };
}

async function getPendingOnceFiles(manifest) {
  const state = await readJson(paths.onceFilesState, { files: {} });
  const files = state.files || {};
  const pending = [];
  for (const item of manifest.files) {
    const relative = normalizeRelative(item.path);
    if (!isOnceFile(relative)) continue;
    const key = relative.toLowerCase();
    const absolute = path.join(paths.game, relative);
    const fingerprint = onceFileFingerprint(item);
    let exists = false;
    try {
      exists = (await fsp.stat(absolute)).isFile();
    } catch {}
    if (!exists || files[key]?.fingerprint !== fingerprint) {
      pending.push(item);
    }
  }
  return pending;
}

async function recordOnceFiles(items) {
  const applied = items.filter((item) => isOnceFile(normalizeRelative(item.path)));
  if (applied.length === 0) return;
  const state = await readJson(paths.onceFilesState, { files: {} });
  const files = state.files || {};
  for (const item of applied) {
    const relative = normalizeRelative(item.path);
    files[relative.toLowerCase()] = {
      fingerprint: onceFileFingerprint(item),
      appliedAt: new Date().toISOString()
    };
  }
  await writeJson(paths.onceFilesState, { files });
}

async function downloadFile(item, index, total) {
  const relative = normalizeRelative(item.path);
  const destination = path.join(paths.game, relative);
  const temporary = `${destination}.download`;
  sendProgress("서버 파일을 설치하고 있습니다.", 20 + Math.round((index / total) * 45), relative);
  const response = await fetch(item.url);
  if (!response.ok) throw new Error(`${relative} 다운로드 실패: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (item.size != null && bytes.length !== item.size) throw new Error(`${relative} 다운로드 크기가 다릅니다.`);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (item.sha256 && digest !== item.sha256.toLowerCase()) throw new Error(`${relative} SHA-256 검증 실패`);
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.writeFile(temporary, bytes);
  await fsp.rename(temporary, destination);
}

async function syncDistribution() {
  const manifest = await getManifest(true);
  const pendingOnceFiles = await getPendingOnceFiles(manifest);
  const verification = await verifyFiles(manifest);
  const badPaths = new Set(verification.problems.map((problem) => problem.split(":")[0].toLowerCase()));
  const downloadsByPath = new Map();
  for (const item of pendingOnceFiles) {
    downloadsByPath.set(normalizeRelative(item.path).toLowerCase(), item);
  }
  for (const item of manifest.files) {
    const key = normalizeRelative(item.path).toLowerCase();
    if (badPaths.has(key)) downloadsByPath.set(key, item);
  }
  const downloads = [...downloadsByPath.values()];
  if (verification.valid && downloads.length === 0) return manifest;
  for (let index = 0; index < downloads.length; index += 1) {
    await downloadFile(downloads[index], index, Math.max(downloads.length, 1));
  }
  await recordOnceFiles(downloads);
  if (config.distribution.strictMode) {
    const expected = new Set(manifest.files.map((item) => normalizeRelative(item.path).toLowerCase()));
    for (const directory of config.distribution.watchDirectories) {
      for (const relative of await walkFiles(path.join(paths.game, directory), paths.game)) {
        if (!expected.has(relative.toLowerCase()) && !isIgnored(relative)) {
          await fsp.rm(path.join(paths.game, relative), { force: true });
        }
      }
    }
  }
  const finalCheck = await verifyFiles(manifest);
  if (!finalCheck.valid) throw new Error(`파일 무결성 복구 실패: ${finalCheck.problems.join(", ")}`);
  return manifest;
}

async function findOrInstallJava() {
  const executable = process.platform === "win32" ? "javaw.exe" : "java";
  const bundled = path.join(paths.runtime, "bin", executable);
  const { resolveJava, fetchJavaRuntimeManifest, installJavaRuntimeTask } = require("@xmcl/installer");
  const bundledInfo = await resolveJava(bundled);
  if (bundledInfo?.majorVersion === config.minecraft.javaMajor) return bundled;

  sendProgress(`Java ${config.minecraft.javaMajor}을(를) 설치하고 있습니다.`, 5);
  const targets = [
    "java-runtime-delta",
    "java-runtime-gamma",
    "java-runtime-beta",
    "java-runtime-alpha",
    "jre-legacy",
    "minecraft-java-exe"
  ];
  let manifest;
  for (const target of targets) {
    try {
      const candidate = await fetchJavaRuntimeManifest({ target });
      const major = Number.parseInt(candidate.version?.name, 10);
      if (major === config.minecraft.javaMajor) {
        manifest = candidate;
        break;
      }
    } catch {
      // Mojang does not publish every target for every platform.
    }
  }
  if (!manifest) {
    throw new Error(`Mojang에서 Java ${config.minecraft.javaMajor} 런타임을 찾지 못했습니다.`);
  }
  await fsp.rm(paths.runtime, { recursive: true, force: true });
  const task = installJavaRuntimeTask({ destination: paths.runtime, manifest });
  await task.startAndWait({
    onUpdate() {
      const percent = task.total > 0 ? Math.round((task.progress / task.total) * 15) : 8;
      sendProgress(`Java ${config.minecraft.javaMajor} 설치 중`, percent);
    }
  });
  const installed = await resolveJava(bundled);
  if (!installed) throw new Error("Java 자동 설치 후 실행 파일을 찾지 못했습니다.");
  return bundled;
}

async function installGame(javaPath) {
  const installer = require("@xmcl/installer");
  const minecraft = paths.game;
  const version = config.minecraft.version;
  const versions = await installer.getVersionList();
  const metadata = versions.versions.find((item) => item.id === version);
  if (!metadata) throw new Error(`Minecraft ${version} 버전을 찾을 수 없습니다.`);

  sendProgress(`Minecraft ${version} 설치 상태 확인 중`, 20);
  await installer.install(metadata, minecraft);
  let launchVersion = version;
  const loader = config.minecraft.loader.toLowerCase();
  if (loader === "fabric") {
    const loaders = await installer.getLoaderArtifactListFor(version);
    const selected = config.minecraft.loaderVersion
      ? loaders.find((item) => item.loader.version === config.minecraft.loaderVersion)
      : loaders.find((item) => item.loader.stable) || loaders[0];
    if (!selected) throw new Error(`Minecraft ${version}용 Fabric Loader를 찾지 못했습니다.`);
    launchVersion = await installer.installFabricByLoaderArtifact(selected, minecraft);
  } else if (loader === "forge") {
    const list = await installer.getForgeVersionList({ minecraft: version });
    const selected = config.minecraft.loaderVersion
      ? list.versions.find((item) => item.version === config.minecraft.loaderVersion)
      : list.versions.find((item) => item.type === "recommended")
        || list.versions.find((item) => item.type === "latest")
        || list.versions[0];
    if (!selected) throw new Error(`Minecraft ${version}용 Forge를 찾지 못했습니다.`);
    launchVersion = await installer.installForge(selected, minecraft, { java: javaPath });
  } else if (loader === "quilt") {
    const loaders = await installer.getQuiltLoaderVersionsByMinecraft({ minecraftVersion: version });
    const selected = config.minecraft.loaderVersion
      ? loaders.find((item) => item.loader.version === config.minecraft.loaderVersion)
      : loaders[0];
    if (!selected) throw new Error(`Minecraft ${version}용 Quilt Loader를 찾지 못했습니다.`);
    launchVersion = await installer.installQuiltVersion({
      minecraftVersion: version,
      version: selected.loader.version,
      minecraft
    });
  } else if (loader === "neoforge") {
    if (!config.minecraft.loaderVersion) throw new Error("NeoForge는 launcher-config.json의 loaderVersion이 필요합니다.");
    launchVersion = await installer.installNeoForged(
      "neoforge",
      config.minecraft.loaderVersion,
      minecraft,
      { java: javaPath }
    );
  } else if (loader !== "vanilla") {
    throw new Error(`지원하지 않는 모드 로더: ${config.minecraft.loader}`);
  }
  await writeJson(path.join(paths.root, "installed-profile.json"), {
    minecraftVersion: version,
    loader,
    loaderVersion: config.minecraft.loaderVersion,
    launchVersion
  });
  return launchVersion;
}

async function ensureLaunchLibraries(launchVersion) {
  const installer = require("@xmcl/installer");
  const { Version } = require("@xmcl/core");
  sendProgress("필수 라이브러리를 확인하고 있습니다.", 82);
  const resolvedVersion = await Version.parse(paths.game, launchVersion);
  try {
    await installer.installLibraries(resolvedVersion);
  } catch (error) {
    throw new Error(`Minecraft 필수 라이브러리 설치 실패: ${error.message}`);
  }
  return resolvedVersion;
}

async function applyGameOptions() {
  const options = config.gameOptions || {};
  const applyMode = options.applyMode || "once";
  if (applyMode === "never") return false;

  const managedOptions = {
    lang: options.lang,
    resourcePacks: options.resourcePacks,
    incompatibleResourcePacks: options.incompatibleResourcePacks,
    keyBindings: options.keyBindings
  };
  const fingerprint = options.revision || crypto
    .createHash("sha256")
    .update(JSON.stringify(managedOptions))
    .digest("hex");
  const appliedState = await readJson(paths.gameOptionsState, {});
  if (applyMode === "once" && appliedState.fingerprint === fingerprint) return false;

  const file = path.join(paths.game, "options.txt");
  let lines = [];
  try {
    lines = (await fsp.readFile(file, "utf8")).split(/\r?\n/).filter(Boolean);
  } catch {}
  const values = new Map(lines.map((line) => {
    const split = line.indexOf(":");
    return split === -1 ? [line, ""] : [line.slice(0, split), line.slice(split + 1)];
  }));
  if (options.lang) values.set("lang", options.lang);
  if (Array.isArray(options.resourcePacks)) values.set("resourcePacks", JSON.stringify(options.resourcePacks));
  if (Array.isArray(options.incompatibleResourcePacks)) {
    values.set("incompatibleResourcePacks", JSON.stringify(options.incompatibleResourcePacks));
  }
  for (const [key, value] of Object.entries(options.keyBindings || {})) {
    values.set(key.startsWith("key_") ? key : `key_${key}`, value);
  }
  await fsp.mkdir(paths.game, { recursive: true });
  await fsp.writeFile(file, [...values].map(([key, value]) => `${key}:${value}`).join("\n") + "\n", "utf8");
  await writeJson(paths.gameOptionsState, {
    fingerprint,
    appliedAt: new Date().toISOString()
  });
  return true;
}

function manifestDigest(manifest) {
  const normalized = [...manifest.files]
    .map((item) => `${normalizeRelative(item.path)}:${item.sha256 || ""}`)
    .sort()
    .join("\n");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function supportsQuickPlay(version) {
  const match = /^(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 20);
}

async function createLaunchSession(manifest) {
  const session = {
    uuid: account.id,
    playerName: account.name,
    manifestVersion: manifest.version,
    manifestSha256: manifestDigest(manifest),
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + config.security.tokenTtlSeconds * 1000).toISOString()
  };
  if (config.security.launcherHandshakeUrl) {
    const response = await fetchJson(config.security.launcherHandshakeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${account.accessToken}`
      },
      body: JSON.stringify(session)
    });
    Object.assign(session, response);
  }
  await writeJson(paths.session, session);
  return session;
}

async function launchGame() {
  await refreshAccount();
  const javaPath = await findOrInstallJava();
  const manifest = await syncDistribution();
  const verification = await verifyFiles(manifest);
  if (!verification.valid) throw new Error(`서버 접속 차단: ${verification.problems.join(", ")}`);
  const optionsApplied = await applyGameOptions();
  sendProgress(
    optionsApplied ? "새 게임 설정을 한 번 적용했습니다." : "사용자 게임 설정을 유지합니다.",
    72
  );
  const installed = await readJson(path.join(paths.root, "installed-profile.json"));
  const expectedProfile = installed
    && installed.minecraftVersion === config.minecraft.version
    && installed.loader === config.minecraft.loader.toLowerCase()
    && installed.loaderVersion === config.minecraft.loaderVersion;
  const launchVersion = expectedProfile ? installed.launchVersion : await installGame(javaPath);
  const resolvedVersion = await ensureLaunchLibraries(launchVersion);
  await createLaunchSession(manifest);

  const { launch, createMinecraftProcessWatcher } = require("@xmcl/core");
  sendProgress("Minecraft를 실행합니다.", 95);
  const server = `${config.server.host}:${config.server.port}`;
  const child = await launch({
    gameProfile: { name: account.name, id: account.id },
    accessToken: account.accessToken,
    userType: "mojang",
    launcherName: config.launcherName,
    launcherBrand: config.launcherName,
    version: resolvedVersion,
    gamePath: paths.game,
    resourcePath: paths.game,
    javaPath,
    minMemory: config.minecraft.minMemoryMb,
    maxMemory: config.minecraft.maxMemoryMb,
    quickPlayMultiplayer: config.server.autoConnect && supportsQuickPlay(config.minecraft.version)
      ? server
      : undefined,
    server: config.server.autoConnect && !supportsQuickPlay(config.minecraft.version)
      ? { ip: config.server.host, port: config.server.port }
      : undefined,
    extraJVMArgs: [`-Dservercraft.session=${paths.session}`]
  });
  child.stdout?.on("data", (data) => mainWindow?.webContents.send("game-log", data.toString().trim()));
  child.stderr?.on("data", (data) => mainWindow?.webContents.send("game-log", data.toString().trim()));
  const watcher = createMinecraftProcessWatcher(child);
  watcher.on("minecraft-window-ready", () => sendProgress("Minecraft 창이 열렸습니다.", 100));
  watcher.on("minecraft-exit", ({ code }) => sendProgress(`Minecraft가 종료되었습니다. (코드 ${code})`, 0));
  return { pid: child.pid };
}

function registerIpc() {
  ipcMain.handle("launcher:initialize", async () => {
    await fsp.mkdir(paths.game, { recursive: true });
    const state = await readJson(paths.state, {});
    applyLauncherState(state);
    account = await loadAccount();
    return {
      config,
      appVersion: app.getVersion(),
      gameDir: paths.game,
      autoConnect: config.server.autoConnect,
      settings: {
        maxMemoryMb: config.minecraft.maxMemoryMb,
        minMemoryMb: config.minecraft.minMemoryMb,
        memoryLimitMb: memoryLimitMb()
      },
      account: account && { id: account.id, name: account.name },
      server: await queryServer()
    };
  });
  ipcMain.handle("server:refresh", queryServer);
  ipcMain.handle("auth:login", async () => {
    const oauth = await loginWithBrowser();
    sendProgress("Minecraft 계정 정보를 확인하고 있습니다.", 0);
    const result = await exchangeMinecraftAccount(oauth);
    await saveAccount(result);
    return { id: result.id, name: result.name };
  });
  ipcMain.handle("auth:logout", async () => {
    await saveAccount(null);
    return null;
  });
  ipcMain.handle("game:install", async () => {
    const javaPath = await findOrInstallJava();
    const launchVersion = await installGame(javaPath);
    await syncDistribution();
    await applyGameOptions();
    return { launchVersion };
  });
  ipcMain.handle("game:verify", async () => verifyFiles(await getManifest(true)));
  ipcMain.handle("game:launch", launchGame);
  ipcMain.handle("folder:game", () => shell.openPath(paths.game));
  ipcMain.handle("folder:config", () => shell.showItemInFolder(configPath()));
  ipcMain.handle("settings:auto-connect", async (_, enabled) => {
    config.server.autoConnect = Boolean(enabled);
    await updateLauncherState({ autoConnect: config.server.autoConnect });
    return config.server.autoConnect;
  });
  ipcMain.handle("settings:save", async (_, settings = {}) => {
    const maxMemoryMb = Math.round(Number(settings.maxMemoryMb));
    if (!Number.isFinite(maxMemoryMb)) throw new Error("램 할당량이 올바르지 않습니다.");
    const clamped = Math.max(config.minecraft.minMemoryMb, Math.min(memoryLimitMb(), maxMemoryMb));
    config.minecraft.maxMemoryMb = clamped;
    await updateLauncherState({ memory: { maxMemoryMb: clamped } });
    return {
      maxMemoryMb: clamped,
      minMemoryMb: config.minecraft.minMemoryMb,
      memoryLimitMb: memoryLimitMb()
    };
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 650,
    title: "ServerCraft Launcher",
    backgroundColor: "#07110e",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.removeMenu();
  await mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(async () => {
  config = await readJson(configPath());
  setupPaths();
  config = await loadRuntimeConfig();
  registerIpc();
  await createWindow();
  configureAutoUpdater();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
