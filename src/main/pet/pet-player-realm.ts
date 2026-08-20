import {
  MessageChannelMain,
  WebContentsView,
  type BrowserWindow,
  type MessagePortMain,
  type Rectangle,
} from 'electron';
import { randomBytes } from 'node:crypto';

import {
  PET_PLAYER_INIT_CHANNEL,
  PET_PLAYER_MAX_ASSET_BYTES,
  PET_PLAYER_PROTOCOL_VERSION,
  createPetPlayerOutputGuard,
  type PetPlayerHostMessage,
  type PetPlayerOutputMessage,
  type PetPlayerProtocolContext,
  type PetSemanticState,
} from '../../shared/pet-player-protocol.js';

import {
  createPetPlayerWebPreferences,
  isPetPlayerNavigationAllowed,
  isPetPlayerRequestAllowed,
} from './pet-player-policy.js';

export interface PetPlayerRealm {
  start(asset: PetPlayerAsset): Promise<void>;
  present(input?: PetPlayerPresentation): void;
  dispose(): void;
}

export interface PetPlayerAsset {
  readonly petGeneration: number;
  readonly runtime: 'rive-canvas-lite' | 'frame-sequence-canvas2d' | 'layered-rig-canvas2d';
  readonly assetSha256: string;
  readonly assetBytes: ArrayBuffer;
}

export interface PetPlayerPresentation {
  readonly bounds: Rectangle;
  readonly petGeneration: number;
  readonly presentationGeneration: number;
  readonly state: PetSemanticState;
  readonly reducedMotion: boolean;
  readonly devicePixelRatio: number;
}

export function createPetPlayerRealm(options: {
  readonly host: BrowserWindow;
  readonly entryUrl: string;
  readonly preloadPath: string;
  readonly onCrash: (reason: string) => void;
  readonly onOutput?: (message: PetPlayerOutputMessage) => void;
  readonly handshakeTimeoutMs?: number;
}): PetPlayerRealm {
  const view = new WebContentsView({
    webPreferences: createPetPlayerWebPreferences(options.preloadPath),
  });
  const playerSession = view.webContents.session;
  let disposed = false;
  let failed = false;
  let startPromise: Promise<void> | undefined;
  let playerPort: MessagePortMain | undefined;
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPresentation: PetPlayerPresentation | undefined;
  let settleHandshake: (() => void) | undefined;
  let rejectHandshake: ((error: Error) => void) | undefined;
  let activeAssetGeneration: number | undefined;
  let assetDelivered = false;
  const context: PetPlayerProtocolContext = {
    realmEpoch: randomBytes(16).toString('hex'),
    nonce: randomBytes(16).toString('hex'),
    petGeneration: 0,
    presentationGeneration: 0,
  };
  const outputGuard = createPetPlayerOutputGuard(context);

  view.setVisible(false);
  view.setBackgroundColor('#00000000');
  options.host.contentView.addChildView(view);

  const denyUnexpectedNavigation = (event: Electron.Event, target: string): void => {
    if (!isPetPlayerNavigationAllowed(options.entryUrl, target) || playerPort !== undefined) {
      event.preventDefault();
      if (playerPort !== undefined) fail('navigation-after-handshake');
    }
  };
  const denyDownload = (event: Electron.Event): void => event.preventDefault();
  view.webContents.on('will-navigate', denyUnexpectedNavigation);
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.webContents.on('render-process-gone', (_event, details) => {
    fail(`render-process-gone:${details.reason}`);
  });
  playerSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  playerSession.setPermissionCheckHandler(() => false);
  playerSession.on('will-download', denyDownload);
  playerSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !isPetPlayerRequestAllowed(options.entryUrl, details.url) });
  });

  return {
    async start(asset: PetPlayerAsset): Promise<void> {
      if (disposed) throw new Error('Pet player realm is disposed');
      if (!isSafePetPlayerAsset(asset)) throw new Error('Invalid pet player asset');
      if (startPromise !== undefined) return startPromise;
      activeAssetGeneration = asset.petGeneration;
      outputGuard.updateGenerations({
        petGeneration: asset.petGeneration,
        presentationGeneration: 0,
      });
      startPromise = startHandshake(asset);
      return startPromise;
    },
    present(input?: PetPlayerPresentation): void {
      if (
        disposed
        || failed
        || input === undefined
        || !isSafePresentation(input)
        || input.petGeneration !== activeAssetGeneration
      ) {
        if (!disposed && !failed && lastPresentation !== undefined) {
          playerPort?.postMessage(toHostPresentation(lastPresentation, context.realmEpoch, false));
        }
        view.setVisible(false);
        return;
      }
      outputGuard.updateGenerations(input);
      lastPresentation = input;
      playerPort?.postMessage(toHostPresentation(input, context.realmEpoch, true));
      view.setBounds(input.bounds);
      view.setVisible(true);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      view.setVisible(false);
      playerPort?.postMessage({ kind: 'dispose', realmEpoch: context.realmEpoch } satisfies PetPlayerHostMessage);
      clearHandshakeTimer();
      revokePort();
      playerSession.removeListener('will-download', denyDownload);
      playerSession.setPermissionRequestHandler(null);
      playerSession.setPermissionCheckHandler(null);
      playerSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, null);
      options.host.contentView.removeChildView(view);
      view.webContents.close();
    },
  };

  async function startHandshake(asset: PetPlayerAsset): Promise<void> {
    await view.webContents.loadURL(options.entryUrl);
    if (disposed || failed) throw new Error('Pet player realm stopped during startup');
    const { port1, port2 } = new MessageChannelMain();
    playerPort = port1;
    const handshake = new Promise<void>((resolve, reject) => {
      settleHandshake = resolve;
      rejectHandshake = reject;
    });
    port1.on('message', ({ data }) => {
      const result = outputGuard.accept(data, Date.now());
      if (result.status === 'rejected') {
        fail(`protocol:${result.code}:${messageKind(data)}`);
        return;
      }
      if (result.message.kind === 'hello') {
        if (assetDelivered) {
          fail('duplicate-hello');
          return;
        }
        assetDelivered = true;
        port1.postMessage({
          kind: 'load-asset',
          realmEpoch: context.realmEpoch,
          petGeneration: asset.petGeneration,
          runtime: asset.runtime,
          assetByteLength: asset.assetBytes.byteLength,
          assetSha256: asset.assetSha256,
          assetBytes: asset.assetBytes,
        } satisfies PetPlayerHostMessage);
        if (lastPresentation?.petGeneration === asset.petGeneration) {
          port1.postMessage(toHostPresentation(lastPresentation, context.realmEpoch, true));
        }
      } else if (result.message.kind === 'ready') {
        clearHandshakeTimer();
        settleHandshake?.();
        settleHandshake = undefined;
        rejectHandshake = undefined;
      } else if (result.message.kind === 'failure' && settleHandshake !== undefined) {
        fail(`player-failure:${result.message.code}`);
        return;
      }
      options.onOutput?.(result.message);
    });
    port1.on('close', () => {
      if (!disposed && !failed) fail('port-closed');
    });
    port1.start();
    handshakeTimer = setTimeout(() => fail('startup-timeout'), options.handshakeTimeoutMs ?? 20_000);
    view.webContents.mainFrame.postMessage(PET_PLAYER_INIT_CHANNEL, {
      protocolVersion: PET_PLAYER_PROTOCOL_VERSION,
      realmEpoch: context.realmEpoch,
      nonce: context.nonce,
    }, [port2]);
    return handshake;
  }

  function fail(reason: string): void {
    if (disposed || failed) return;
    failed = true;
    view.setVisible(false);
    clearHandshakeTimer();
    const reject = rejectHandshake;
    settleHandshake = undefined;
    rejectHandshake = undefined;
    revokePort();
    reject?.(new Error(`Pet player realm failed: ${reason}`));
    options.onCrash(reason);
  }

  function revokePort(): void {
    const activePort = playerPort;
    playerPort = undefined;
    activePort?.close();
  }

  function clearHandshakeTimer(): void {
    if (handshakeTimer !== undefined) clearTimeout(handshakeTimer);
    handshakeTimer = undefined;
  }
}

function messageKind(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return 'unknown';
  return typeof value.kind === 'string' && /^[a-z-]{1,32}$/.test(value.kind) ? value.kind : 'unknown';
}

export function isSafePetPlayerAsset(asset: PetPlayerAsset): boolean {
  return Number.isSafeInteger(asset.petGeneration)
    && asset.petGeneration >= 0
    && (asset.runtime === 'rive-canvas-lite' || asset.runtime === 'frame-sequence-canvas2d' || asset.runtime === 'layered-rig-canvas2d')
    && /^[a-f0-9]{64}$/.test(asset.assetSha256)
    && asset.assetBytes instanceof ArrayBuffer
    && asset.assetBytes.byteLength > 0
    && asset.assetBytes.byteLength <= PET_PLAYER_MAX_ASSET_BYTES;
}

function isSafePresentationBounds(bounds: Rectangle): boolean {
  return Number.isSafeInteger(bounds.x)
    && Number.isSafeInteger(bounds.y)
    && Number.isSafeInteger(bounds.width)
    && Number.isSafeInteger(bounds.height)
    && bounds.x >= 0
    && bounds.y >= 0
    && bounds.width > 0
    && bounds.width <= 560
    && bounds.height > 0
    && bounds.height <= 320;
}

function isSafePresentation(input: PetPlayerPresentation): boolean {
  return isSafePresentationBounds(input.bounds)
    && Number.isSafeInteger(input.petGeneration)
    && input.petGeneration >= 0
    && Number.isSafeInteger(input.presentationGeneration)
    && input.presentationGeneration >= 0
    && typeof input.reducedMotion === 'boolean'
    && Number.isFinite(input.devicePixelRatio)
    && input.devicePixelRatio >= 0.5
    && input.devicePixelRatio <= 4;
}

function toHostPresentation(
  input: PetPlayerPresentation,
  realmEpoch: string,
  visible: boolean,
): PetPlayerHostMessage {
  return {
    kind: 'present',
    realmEpoch,
    petGeneration: input.petGeneration,
    presentationGeneration: input.presentationGeneration,
    state: input.state,
    visible,
    reducedMotion: input.reducedMotion,
    viewport: {
      width: input.bounds.width,
      height: input.bounds.height,
      devicePixelRatio: input.devicePixelRatio,
    },
  };
}
