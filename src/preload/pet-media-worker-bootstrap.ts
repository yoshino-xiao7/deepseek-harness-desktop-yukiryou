import { ipcRenderer } from 'electron';

import {
  PET_MEDIA_WORKER_INIT_CHANNEL,
  PET_MEDIA_WORKER_WINDOW_PORT_MESSAGE,
  parsePetMediaWorkerInitEnvelope,
} from '../shared/pet-media-worker-protocol.js';

const receivePort = (event: Electron.IpcRendererEvent, value: unknown): void => {
  const init = parsePetMediaWorkerInitEnvelope(value);
  if (init === undefined || event.ports.length !== 1) return;
  ipcRenderer.removeListener(PET_MEDIA_WORKER_INIT_CHANNEL, receivePort);
  window.postMessage({ kind: PET_MEDIA_WORKER_WINDOW_PORT_MESSAGE, init }, '*', event.ports);
};

ipcRenderer.on(PET_MEDIA_WORKER_INIT_CHANNEL, receivePort);
