import { ipcRenderer } from 'electron';

import {
  PET_PLAYER_INIT_CHANNEL,
  PET_PLAYER_WINDOW_PORT_MESSAGE,
  parsePetPlayerInitEnvelope,
} from '../shared/pet-player-protocol.js';

// The player receives exactly one capability. No Electron API or Workspace
// bridge is exposed in its main world.
const receivePort = (event: Electron.IpcRendererEvent, value: unknown): void => {
  const init = parsePetPlayerInitEnvelope(value);
  if (init === undefined || event.ports.length !== 1) return;
  ipcRenderer.removeListener(PET_PLAYER_INIT_CHANNEL, receivePort);
  window.postMessage({ kind: PET_PLAYER_WINDOW_PORT_MESSAGE, init }, '*', event.ports);
};

ipcRenderer.on(PET_PLAYER_INIT_CHANNEL, receivePort);
