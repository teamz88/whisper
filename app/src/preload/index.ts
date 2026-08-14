import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  BRIDGE_KEY,
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  SEND_CHANNELS,
  type IpcEventChannel,
  type IpcInvokeChannel,
  type IpcSendChannel,
  type WhisperBridge,
} from '../shared/ipc.js';

/**
 * The entire surface the renderer gets. contextIsolation is on and
 * nodeIntegration is off, so this file is the only thing standing between the
 * UI and Electron — and it exposes three functions, not `ipcRenderer`.
 *
 * Every channel is checked against the allowlists in shared/ipc.ts. Handing the
 * renderer a raw `invoke` would let any injected script call any handler in
 * main; a compromised renderer here can only reach channels we declared.
 */

const invoke = ((channel: IpcInvokeChannel, payload?: unknown): Promise<unknown> => {
  if (!INVOKE_CHANNELS.includes(channel)) {
    return Promise.reject(new Error(`Blocked IPC channel: ${String(channel)}`));
  }
  return ipcRenderer.invoke(channel, payload);
}) as WhisperBridge['invoke'];

const send = ((channel: IpcSendChannel, payload?: unknown): void => {
  if (!SEND_CHANNELS.includes(channel)) {
    console.error(`Blocked IPC channel: ${String(channel)}`);
    return;
  }
  ipcRenderer.send(channel, payload);
}) as WhisperBridge['send'];

const on = ((channel: IpcEventChannel, listener: (payload: unknown) => void): (() => void) => {
  if (!EVENT_CHANNELS.includes(channel)) {
    console.error(`Blocked IPC channel: ${String(channel)}`);
    return () => undefined;
  }

  const handler = (_event: IpcRendererEvent, payload: unknown): void => {
    listener(payload);
  };

  ipcRenderer.on(channel, handler);
  // Returned so a React effect can unsubscribe. Without this, every remount
  // stacks another listener and the app slowly leaks.
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}) as WhisperBridge['on'];

const bridge: WhisperBridge = { invoke, send, on };

contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge);
