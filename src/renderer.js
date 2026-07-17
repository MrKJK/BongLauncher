const elements = Object.fromEntries(
  [
    "account", "avatar", "avatar-image", "avatar-fallback", "server-state", "players", "ping",
    "mc-version", "loader", "game-dir", "integrity", "auto-connect", "status",
    "progress", "log", "config", "login", "play", "play-label", "launcher-version",
    "settings-modal", "settings-close", "settings-save", "memory-range",
    "memory-input", "memory-label", "server-resource-packs"
  ].map((id) => [id, document.getElementById(id)])
);

let state;
let busy = false;
let gameRunning = false;

function renderPlayButton() {
  elements["play-label"].textContent = gameRunning ? "게임 실행 중" : "게임 시작";
  elements.play.disabled = busy || gameRunning || !state?.account;
}

function setBusy(value, message) {
  busy = value;
  renderPlayButton();
  elements.login.disabled = value;
  if (message) elements.status.textContent = message;
}

function skinUrl(account) {
  return account?.name
    ? `https://mc-heads.net/avatar/${encodeURIComponent(account.name)}/64`
    : "";
}

function renderAccount(account) {
  elements.account.textContent = account ? account.name : "로그인";
  elements.login.title = account ? "Microsoft 로그아웃" : "Microsoft 로그인";
  renderPlayButton();
  elements.avatar.classList.remove("has-skin");
  elements["avatar-image"].hidden = true;
  elements["avatar-image"].removeAttribute("src");
  elements["avatar-fallback"].hidden = false;
  elements["avatar-fallback"].textContent = account?.name?.slice(0, 1).toUpperCase() || "M";
  if (!account) return;

  elements["avatar-image"].onload = () => {
    elements.avatar.classList.add("has-skin");
    elements["avatar-image"].hidden = false;
    elements["avatar-fallback"].hidden = true;
  };
  elements["avatar-image"].onerror = () => {
    elements.avatar.classList.remove("has-skin");
    elements["avatar-image"].hidden = true;
    elements["avatar-fallback"].hidden = false;
  };
  elements["avatar-image"].src = skinUrl(account);
}

function renderServer(server) {
  const online = server?.online;
  elements["server-state"].className = `state ${online ? "online" : "offline"}`;
  elements["server-state"].textContent = online ? "온라인" : "오프라인";
  elements.players.textContent = online
    ? `${server.players.online} / ${server.players.max}`
    : "- / -";
  elements.ping.textContent = online ? `${server.ping} ms` : "- ms";
}

function formatMemory(mb) {
  const gb = mb / 1024;
  return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
}

function setMemoryValue(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return;
  const min = Number(elements["memory-range"].min) || 2048;
  const max = Number(elements["memory-range"].max) || 16384;
  const mb = Math.max(min, Math.min(max, Math.round(raw / 512) * 512));
  elements["memory-range"].value = mb;
  elements["memory-input"].value = mb;
  elements["memory-label"].textContent = formatMemory(mb);
}

function renderSettings(settings) {
  const min = settings?.minMemoryMb || 2048;
  const max = Math.max(min, settings?.memoryLimitMb || 16384);
  const value = Math.max(min, Math.min(max, settings?.maxMemoryMb || state.config.minecraft.maxMemoryMb));
  elements["memory-range"].min = min;
  elements["memory-range"].max = max;
  elements["memory-input"].min = min;
  elements["memory-input"].max = max;
  elements["server-resource-packs"].checked = settings?.acceptServerResourcePacks !== false;
  setMemoryValue(value);
}

function openSettings() {
  renderSettings(state.settings);
  elements["settings-modal"].classList.add("open");
  elements["settings-modal"].setAttribute("aria-hidden", "false");
  elements["memory-range"].focus();
}

function closeSettings() {
  elements["settings-modal"].classList.remove("open");
  elements["settings-modal"].setAttribute("aria-hidden", "true");
}

async function refreshServer() {
  elements["server-state"].className = "state checking";
  elements["server-state"].textContent = "확인 중";
  renderServer(await window.launcher.refreshServer());
}

async function initialize() {
  state = await window.launcher.initialize();
  gameRunning = Boolean(state.gameRunning);
  document.title = state.config.windowTitle;
  elements["launcher-version"].textContent = `launcher v${state.appVersion}`;
  elements["mc-version"].textContent = state.config.minecraft.version;
  elements.loader.textContent = state.config.minecraft.loader.toUpperCase();
  elements["game-dir"].textContent = state.gameDir;
  elements["auto-connect"].checked = state.autoConnect;
  renderSettings(state.settings);
  renderAccount(state.account);
  renderServer(state.server);
  elements.status.textContent = state.account
    ? "게임을 시작할 준비가 되었습니다."
    : "Microsoft 계정으로 로그인해 주세요.";
}

window.launcher.onProgress(({ message, percent = 0, detail = "" }) => {
  elements.status.textContent = message;
  elements.progress.value = percent;
  if (detail) {
    elements.log.textContent = `${detail}\n${elements.log.textContent}`.slice(0, 6000);
  }
});

window.launcher.onGameLog((line) => {
  elements.log.textContent = `${line}\n${elements.log.textContent}`.slice(0, 6000);
});

window.launcher.onGameState(({ running, message = "" }) => {
  gameRunning = Boolean(running);
  renderPlayButton();
  if (message) elements.status.textContent = message;
});

elements.config.addEventListener("click", openSettings);
elements["settings-close"].addEventListener("click", closeSettings);
elements["settings-modal"].addEventListener("click", (event) => {
  if (event.target === elements["settings-modal"]) closeSettings();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSettings();
});

elements["memory-range"].addEventListener("input", (event) => setMemoryValue(event.target.value));
elements["memory-input"].addEventListener("input", (event) => setMemoryValue(event.target.value));
elements["settings-save"].addEventListener("click", async () => {
  elements["settings-save"].disabled = true;
  try {
    state.settings = await window.launcher.saveSettings({
      maxMemoryMb: Number(elements["memory-input"].value),
      acceptServerResourcePacks: elements["server-resource-packs"].checked
    });
    state.config.minecraft.maxMemoryMb = state.settings.maxMemoryMb;
    renderSettings(state.settings);
    closeSettings();
    elements.status.textContent = "게임 설정을 저장했습니다.";
  } catch (error) {
    elements.status.textContent = `설정 저장 실패: ${error.message}`;
  } finally {
    elements["settings-save"].disabled = false;
  }
});

elements["auto-connect"].addEventListener("change", async (event) => {
  state.autoConnect = await window.launcher.setAutoConnect(event.target.checked);
  elements["auto-connect"].checked = state.autoConnect;
});

elements.login.addEventListener("click", async () => {
  setBusy(true, state.account ? "로그아웃 중..." : "Microsoft 로그인 준비 중...");
  try {
    state.account = state.account
      ? await window.launcher.logout()
      : await window.launcher.login();
    renderAccount(state.account);
    elements.status.textContent = state.account
      ? "로그인되었습니다."
      : "로그아웃되었습니다.";
  } catch (error) {
    elements.status.textContent = `로그인 실패: ${error.message}`;
  } finally {
    setBusy(false);
  }
});

elements.play.addEventListener("click", async () => {
  gameRunning = true;
  setBusy(true, "설치 상태를 확인하고 있습니다...");
  try {
    await window.launcher.launch();
    elements.status.textContent = "게임 실행 중";
  } catch (error) {
    gameRunning = false;
    elements.status.textContent = `실행 실패: ${error.message}`;
  } finally {
    setBusy(false);
  }
});

initialize().catch((error) => {
  elements.status.textContent = `초기화 실패: ${error.message}`;
});
