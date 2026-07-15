const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  initialize: () => ipcRenderer.invoke("launcher:initialize"),
  login: () => ipcRenderer.invoke("auth:login"),
  logout: () => ipcRenderer.invoke("auth:logout"),
  install: () => ipcRenderer.invoke("game:install"),
  verify: () => ipcRenderer.invoke("game:verify"),
  launch: () => ipcRenderer.invoke("game:launch"),
  refreshServer: () => ipcRenderer.invoke("server:refresh"),
  openGameFolder: () => ipcRenderer.invoke("folder:game"),
  openConfig: () => ipcRenderer.invoke("folder:config"),
  setAutoConnect: (enabled) => ipcRenderer.invoke("settings:auto-connect", enabled),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  onProgress: (callback) => ipcRenderer.on("progress", (_, value) => callback(value)),
  onGameLog: (callback) => ipcRenderer.on("game-log", (_, value) => callback(value))
});
