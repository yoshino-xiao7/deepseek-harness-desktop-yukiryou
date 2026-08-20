import {
  PET_MEDIA_WORKER_PROTOCOL_VERSION,
  PET_MEDIA_WORKER_WINDOW_PORT_MESSAGE,
  parsePetMediaWorkerHostMessage,
  parsePetMediaWorkerInitEnvelope,
  type PetMediaWorkerOutputMessage,
} from '../../shared/pet-media-worker-protocol.js';
import { decodePetMotionAtlas } from './browser-atlas-decoder.js';
import { rasterizePetMotionVideo } from './browser-motion-rasterizer.js';

const receivePort = (event: MessageEvent): void => {
  const [port] = event.ports;
  if (event.source !== window || event.ports.length !== 1 || port === undefined || !isRecord(event.data)) return;
  if (event.data.kind !== PET_MEDIA_WORKER_WINDOW_PORT_MESSAGE) return;
  const init = parsePetMediaWorkerInitEnvelope(event.data.init);
  if (init === undefined) return;
  window.removeEventListener('message', receivePort);
  port.start();
  port.postMessage({
    kind: 'hello',
    protocolVersion: PET_MEDIA_WORKER_PROTOCOL_VERSION,
    realmEpoch: init.realmEpoch,
    nonce: init.nonce,
  } satisfies PetMediaWorkerOutputMessage);
  runWorker(port, init.realmEpoch);
};

window.addEventListener('message', receivePort);

function runWorker(port: MessagePort, realmEpoch: string): void {
  let acceptedJob = false;
  let disposed = false;
  let controller: AbortController | undefined;
  port.onmessage = ({ data }) => {
    const message = parsePetMediaWorkerHostMessage(data, realmEpoch);
    if (message === undefined) return;
    if (message.kind === 'dispose') {
      disposed = true;
      controller?.abort();
      port.close();
      return;
    }
    if (acceptedJob) return;
    acceptedJob = true;
    controller = new AbortController();
    const job = message.kind === 'rasterize'
      ? rasterizeJob(message, controller.signal, realmEpoch)
      : decodeAtlasJob(message, controller.signal, realmEpoch);
    void job
      .then((result) => {
        if (disposed) return;
        port.postMessage(result);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        port.postMessage({
          kind: 'failure',
          realmEpoch,
          jobGeneration: message.jobGeneration,
          code: controller?.signal.aborted ? 'aborted' : classifyFailure(error),
        } satisfies PetMediaWorkerOutputMessage);
      });
  };
}

async function rasterizeJob(
  message: Extract<ReturnType<typeof parsePetMediaWorkerHostMessage>, { kind: 'rasterize' }>,
  signal: AbortSignal,
  realmEpoch: string,
): Promise<PetMediaWorkerOutputMessage> {
  const result = await rasterizePetMotionVideo({ bytes: message.clipBytes, spec: message.spec, signal });
  return {
    kind: 'result',
    realmEpoch,
    jobGeneration: message.jobGeneration,
    atlasBytes: ownedArrayBuffer(result.atlas.bytes),
    atlas: {
      motion: result.atlas.motion,
      mediaType: 'image/png',
      width: result.atlas.width,
      height: result.atlas.height,
      columns: result.atlas.columns,
      rows: result.atlas.rows,
      frameCount: result.atlas.frameCount,
      durationMs: result.atlas.durationMs,
    },
    evidence: result.evidence,
  };
}

async function decodeAtlasJob(
  message: Extract<ReturnType<typeof parsePetMediaWorkerHostMessage>, { kind: 'decode-atlas' }>,
  signal: AbortSignal,
  realmEpoch: string,
): Promise<PetMediaWorkerOutputMessage> {
  const result = await decodePetMotionAtlas({ bytes: message.atlasBytes, atlas: message.atlas, signal });
  return {
    kind: 'decoded-atlas',
    realmEpoch,
    jobGeneration: message.jobGeneration,
    framesBytes: ownedArrayBuffer(result.framesBytes),
    cellWidth: result.cellWidth,
    cellHeight: result.cellHeight,
    frameCount: result.frameCount,
  };
}

function classifyFailure(error: unknown): 'invalid-input' | 'decode-failed' | 'rasterization-failed' {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('invalid motion')) return 'invalid-input';
  if (message.includes('decode') || message.includes('atlas')) return 'decode-failed';
  return 'rasterization-failed';
}

function ownedArrayBuffer(bytes: Uint8Array | Uint8ClampedArray): ArrayBuffer {
  const output = new Uint8Array(bytes.byteLength);
  output.set(bytes);
  return output.buffer;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
