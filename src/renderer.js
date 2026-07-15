const elements = Object.fromEntries(
  [
    "account", "avatar", "server-state", "server-name", "motd", "players", "ping",
    "mc-version", "loader", "game-dir", "integrity", "auto-connect", "status",
    "progress", "log", "refresh", "config", "login", "play", "launcher-version",
    "settings-modal", "settings-close", "settings-save", "memory-range",
    "memory-input", "memory-label"
  ].map((id) => [id, document.getElementById(id)])
);

let state;
let busy = false;

function setBusy(value, message) {
  busy = value;
  elements.play.disabled = value || !state?.account;
  elements.login.disabled = value;
  if (message) elements.status.textContent = message;
}

function skinUrl(account) {
  return account?.id
    ? `https://crafatar.com/avatars/${account.id}?overlay&size=64`
    : "";
}

function renderAccount(account) {
  elements.account.textContent = account ? account.name : "로그인";
  elements.login.title = account ? "Microsoft 로그아웃" : "Microsoft 로그인";
  elements.play.disabled = busy || !account;
  elements.avatar.classList.toggle("has-skin", Boolean(account));
  elements.avatar.textContent = account ? "" : "M";
  elements.avatar.style.backgroundImage = account ? `url("${skinUrl(account)}")` : "";
}

function renderServer(server) {
  const online = server?.online;
  elements["server-state"].className = `state ${online ? "online" : "offline"}`;
  elements["server-state"].textContent = online ? "온라인" : "오프라인";
  elements["server-name"].textContent = server?.name || state.config.server.name;
  elements.motd.textContent = server?.motd || (
    online ? "서버가 온라인입니다." : "서버에 연결할 수 없습니다."
  );
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
  document.title = state.config.windowTitle;
  elements["launcher-version"].textContent = `launcher v${state.appVersion}`;
  elements["server-name"].textContent = state.config.server.name;
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

elements.refresh.addEventListener("click", refreshServer);
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
      maxMemoryMb: Number(elements["memory-input"].value)
    });
    state.config.minecraft.maxMemoryMb = state.settings.maxMemoryMb;
    renderSettings(state.settings);
    closeSettings();
    elements.status.textContent = `램 할당량을 ${formatMemory(state.settings.maxMemoryMb)}로 저장했습니다.`;
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
  setBusy(true, "설치 상태를 확인하고 있습니다...");
  try {
    const result = await window.launcher.launch();
    elements.status.textContent = `게임을 실행했습니다. PID ${result.pid}`;
  } catch (error) {
    elements.status.textContent = `실행 실패: ${error.message}`;
  } finally {
    setBusy(false);
  }
});

initialize().catch((error) => {
  elements.status.textContent = `초기화 실패: ${error.message}`;
});
