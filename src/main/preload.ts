import { contextBridge, ipcRenderer } from "electron";
import {
  createInvokeBridge,
  IPC_EVENT_CHANNELS,
  type LightcodeBridge,
  type SupervisorEvent,
  type UpdateStatus,
} from "@/shared/ipc";

function resolveAppVersion(): string {
  const prefix = "--lc-app-version=";
  for (const arg of process.argv) {
    if (arg.startsWith(prefix)) {
      const raw = arg.slice(prefix.length);
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return process.env.npm_package_version ?? "dev";
}

const bridge: LightcodeBridge = {
  platform: process.platform,
  appVersion: resolveAppVersion(),
  electronVersion: process.versions.electron ?? "unknown",
  ...createInvokeBridge((channel, ...args) => ipcRenderer.invoke(channel, ...args)),
  onSupervisorEvent(listener) {
    const handler = (_event: Electron.IpcRendererEvent, payload: SupervisorEvent) => {
      listener(payload);
    };
    ipcRenderer.on(IPC_EVENT_CHANNELS.supervisorEvent, handler);
    return () => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.supervisorEvent, handler);
    };
  },
  onUpdateStatus(listener) {
    const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => {
      listener(status);
    };
    ipcRenderer.on(IPC_EVENT_CHANNELS.updateStatus, handler);
    return () => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.updateStatus, handler);
    };
  },
};

contextBridge.exposeInMainWorld("lightcode", bridge);
