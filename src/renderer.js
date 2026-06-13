const elements = Object.fromEntries(
  [
    "launcher-name", "account", "server-state", "server-name", "motd", "players",
    "ping", "mc-version", "loader", "game-dir", "integrity", "auto-connect",
    "status", "progress", "log", "refresh", "folder", "config", "verify", "login", "play",
    "launcher-version"
  ].map((id) => [id, document.getElementById(id)])
);

let state;
let busy = false;

function setBusy(value, message) {
  busy = value;
  elements.play.disabled = value || !state?.account;
  elements.login.disabled = value;
  elements.verify.disabled = value;
  if (message) elements.status.textContent = message;
}

function renderAccount(account) {
  elements.account.textContent = account ? account.name : "로그인";
  elements.login.title = account ? "Microsoft 로그아웃" : "Microsoft 로그인";
  elements.play.disabled = busy || !account;
}

function renderServer(server) {
  const online = server?.online;
  elements["server-state"].className = `state ${online ? "online" : "offline"}`;
  elements["server-state"].textContent = online ? "ONLINE" : "OFFLINE";
  elements["server-name"].textContent = server?.name || state.config.server.name;
  elements.motd.textContent = server?.motd || (
    online ? "서버가 온라인입니다." : "서버에 연결할 수 없습니다."
  );
  elements.players.textContent = online
    ? `${server.players.online} / ${server.players.max}`
    : "- / -";
  elements.ping.textContent = online ? `${server.ping} ms` : "- ms";
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
  elements["launcher-name"].textContent = state.config.launcherName;
  elements["server-name"].textContent = state.config.server.name;
  elements["mc-version"].textContent = state.config.minecraft.version;
  elements.loader.textContent = state.config.minecraft.loader.toUpperCase();
  elements["game-dir"].textContent = state.gameDir;
  elements["auto-connect"].checked = state.autoConnect;
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
elements.folder.addEventListener("click", () => window.launcher.openGameFolder());
elements.config.addEventListener("click", () => window.launcher.openConfig());
elements["auto-connect"].addEventListener("change", (event) => {
  window.launcher.setAutoConnect(event.target.checked);
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

elements.verify.addEventListener("click", async () => {
  setBusy(true, "서버 파일을 검사하고 있습니다...");
  try {
    const result = await window.launcher.verify();
    elements.integrity.textContent = result.valid
      ? "정상"
      : `변경됨 ${result.problems.length}개`;
    elements.status.textContent = result.valid
      ? "모든 관리 파일이 정상입니다."
      : result.problems.join(", ");
  } catch (error) {
    elements.status.textContent = `파일 검사 실패: ${error.message}`;
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
