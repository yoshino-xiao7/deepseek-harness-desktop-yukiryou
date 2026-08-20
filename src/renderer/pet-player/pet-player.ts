import {
  PET_PLAYER_WINDOW_PORT_MESSAGE,
  parsePetPlayerHostMessageForRealm,
  parsePetPlayerInitEnvelope,
  type PetPlayerHostMessage,
  type PetPlayerOutputMessage,
} from '../../shared/pet-player-protocol.js';
import { summarizePetFrameTimestamps } from '../../shared/pet-frame-metrics.js';
import { createRiveCanvasLiteAdapter } from './rive-canvas-lite-adapter.js';
import { createRiveCanvasLiteRuntime } from './rive-canvas-lite-runtime.js';
import { createBrowserFrameSequenceCanvasRuntime, createFrameSequenceCanvas2dAdapter } from './frame-sequence-canvas2d-adapter.js';
import { createBrowserLayeredRigCanvasRuntime, createLayeredRigCanvas2dAdapter } from './layered-rig-canvas2d-adapter.js';
import { verifyPetPlayerAsset } from './pet-player-asset.js';

const receivePort = (event: MessageEvent): void => {
  const [port] = event.ports;
  if (event.source !== window || port === undefined || event.ports.length !== 1 || !isRecord(event.data)) return;
  if (event.data.kind !== PET_PLAYER_WINDOW_PORT_MESSAGE) return;
  const init = parsePetPlayerInitEnvelope(event.data.init);
  if (init === undefined) return;
  window.removeEventListener('message', receivePort);
  port.start();
  const hello: PetPlayerOutputMessage = {
    kind: 'hello',
    protocolVersion: 1,
    realmEpoch: init.realmEpoch,
    nonce: init.nonce,
  };
  port.postMessage(hello);
  document.body.dataset.playerReady = 'true';
  runPlayer(port, init.realmEpoch);
};

window.addEventListener('message', receivePort);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function runPlayer(port: MessagePort, realmEpoch: string): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#pet-canvas');
  let runtimeAdapter: ReturnType<typeof createRiveCanvasLiteAdapter> | undefined;
  let loadedPetGeneration = -1;
  let loadingPetGeneration = -1;
  let activePresentationGeneration = -1;
  let pendingPresentation: Extract<PetPlayerHostMessage, { kind: 'present' }> | undefined;
  const receivedAssetGenerations = new Set<number>();
  let frameHandle: number | undefined;
  let frameTimestamps: number[] = [];
  let longTaskCount = 0;
  let disposed = false;
  const activate = (): void => {
    if (disposed || loadedPetGeneration < 0 || activePresentationGeneration < 0) return;
    port.postMessage({
      kind: 'activation',
      realmEpoch,
      petGeneration: loadedPetGeneration,
      presentationGeneration: activePresentationGeneration,
    } satisfies PetPlayerOutputMessage);
  };
  canvas?.addEventListener('pointerdown', activate);
  const longTaskObserver = createLongTaskObserver(() => { longTaskCount += 1; });
  const heartbeatTimer = window.setInterval(() => {
    if (!disposed) port.postMessage({ kind: 'heartbeat', realmEpoch } satisfies PetPlayerOutputMessage);
  }, 1_200);
  const metricsTimer = window.setInterval(() => reportMetrics(), 5_000);

  port.onmessage = ({ data }) => {
    const message = parsePetPlayerHostMessageForRealm(data, realmEpoch);
    if (message === undefined) return;
    if (message.kind === 'dispose') {
      dispose();
      return;
    }
    if (message.kind === 'load-asset') {
      void loadAsset(message);
      return;
    }
    if (!isFreshPresentation(message)) return;
    if (message.petGeneration !== loadedPetGeneration) {
      pendingPresentation = message;
      return;
    }
    present(message);
  };

  async function loadAsset(message: Extract<PetPlayerHostMessage, { kind: 'load-asset' }>): Promise<void> {
    if (disposed) return;
    if (canvas === null || receivedAssetGenerations.size > 0 || receivedAssetGenerations.has(message.petGeneration)) {
      postFailure(message.petGeneration, 'asset-load-failed', 'asset-delivery-rejected');
      return;
    }
    receivedAssetGenerations.add(message.petGeneration);
    loadingPetGeneration = message.petGeneration;
    const verified = await verifyPetPlayerAsset({
      bytes: message.assetBytes,
      byteLength: message.assetByteLength,
      sha256: message.assetSha256,
    });
    if (disposed || loadingPetGeneration !== message.petGeneration) return;
    if (!verified) {
      postFailure(message.petGeneration, 'asset-load-failed', 'asset-integrity-check-failed');
      return;
    }
    runtimeAdapter?.dispose();
    runtimeAdapter = message.runtime === 'rive-canvas-lite'
      ? createRiveCanvasLiteAdapter(createRiveCanvasLiteRuntime())
      : message.runtime === 'frame-sequence-canvas2d'
        ? createFrameSequenceCanvas2dAdapter(createBrowserFrameSequenceCanvasRuntime())
        : createLayeredRigCanvas2dAdapter(createBrowserLayeredRigCanvasRuntime());
    const result = await runtimeAdapter.load({ canvas, assetBytes: message.assetBytes });
    if (disposed || loadingPetGeneration !== message.petGeneration) return;
    if (result.status === 'rejected') {
      postFailure(
        message.petGeneration,
        result.code === 'runtime-unavailable' ? 'renderer-unavailable' : 'asset-load-failed',
        result.code,
      );
      return;
    }
    loadingPetGeneration = -1;
    loadedPetGeneration = message.petGeneration;
    port.postMessage({
      kind: 'ready',
      realmEpoch,
      petGeneration: loadedPetGeneration,
    } satisfies PetPlayerOutputMessage);
    if (pendingPresentation?.petGeneration === loadedPetGeneration) {
      const pending = pendingPresentation;
      pendingPresentation = undefined;
      present(pending);
    }
  }

  function present(message: Extract<PetPlayerHostMessage, { kind: 'present' }>): void {
    activePresentationGeneration = message.presentationGeneration;
    document.body.dataset.petState = message.state;
    document.body.dataset.reducedMotion = String(message.reducedMotion);
    const result = runtimeAdapter?.present({
      state: message.state,
      visible: message.visible,
      reducedMotion: message.reducedMotion,
      viewport: message.viewport,
    });
    if (result?.status !== 'presented') {
      postFailure(message.petGeneration, 'runtime-error', 'presentation-rejected');
      return;
    }
    if (message.visible) startFrameSampling();
    else stopFrameSampling();
  }

  function isFreshPresentation(message: Extract<PetPlayerHostMessage, { kind: 'present' }>): boolean {
    if (message.petGeneration !== loadedPetGeneration) {
      return pendingPresentation === undefined
        || message.petGeneration > pendingPresentation.petGeneration
        || (message.petGeneration === pendingPresentation.petGeneration
          && message.presentationGeneration >= pendingPresentation.presentationGeneration);
    }
    return message.presentationGeneration >= activePresentationGeneration;
  }

  function startFrameSampling(): void {
    if (frameHandle !== undefined) return;
    const sample = (timestamp: number): void => {
      frameTimestamps.push(timestamp);
      frameHandle = window.requestAnimationFrame(sample);
    };
    frameHandle = window.requestAnimationFrame(sample);
  }

  function stopFrameSampling(): void {
    if (frameHandle !== undefined) window.cancelAnimationFrame(frameHandle);
    frameHandle = undefined;
    frameTimestamps = [];
  }

  function reportMetrics(): void {
    if (loadedPetGeneration < 0 || activePresentationGeneration < 0) return;
    const metrics = summarizePetFrameTimestamps(frameTimestamps);
    const finalTimestamp = frameTimestamps.at(-1);
    frameTimestamps = finalTimestamp === undefined ? [] : [finalTimestamp];
    if (metrics === undefined) return;
    port.postMessage({
      kind: 'metrics',
      realmEpoch,
      petGeneration: loadedPetGeneration,
      presentationGeneration: activePresentationGeneration,
      ...metrics,
      longTaskCount,
    } satisfies PetPlayerOutputMessage);
    longTaskCount = 0;
  }

  function postFailure(
    petGeneration: number,
    code: Extract<PetPlayerOutputMessage, { kind: 'failure' }>['code'],
    detail: string,
  ): void {
    port.postMessage({ kind: 'failure', realmEpoch, petGeneration, code, detail } satisfies PetPlayerOutputMessage);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    window.clearInterval(heartbeatTimer);
    window.clearInterval(metricsTimer);
    stopFrameSampling();
    longTaskObserver?.disconnect();
    canvas?.removeEventListener('pointerdown', activate);
    runtimeAdapter?.dispose();
    runtimeAdapter = undefined;
    port.close();
  }
}

function createLongTaskObserver(onLongTask: () => void): PerformanceObserver | undefined {
  if (typeof PerformanceObserver === 'undefined') return undefined;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= 50) onLongTask();
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
    return observer;
  } catch {
    return undefined;
  }
}
