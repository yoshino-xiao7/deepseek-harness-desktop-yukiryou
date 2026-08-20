import { BrowserWindow, MessageChannelMain, type MessagePortMain } from 'electron';
import { randomBytes } from 'node:crypto';

import {
  PET_MEDIA_WORKER_FRAME_BYTES,
  PET_MEDIA_WORKER_INIT_CHANNEL,
  PET_MEDIA_WORKER_PROTOCOL_VERSION,
  parsePetMediaWorkerOutputMessage,
  type PetMediaWorkerHostMessage,
  type PetMediaWorkerOutputMessage,
} from '../../shared/pet-media-worker-protocol.js';
import type { GeneratedMotionAtlas } from './frame-sequence-authoring-adapter.js';
import { PetVisualGenerationError } from './frame-sequence-generation-orchestrator.js';
import type { DecodedPetAtlas, PetAtlasFrameDecoder } from './frame-sequence-visual-qa.js';
import type { PetMotionClipRasterization, PetMotionClipRasterizer, PetMotionClipRasterizerRequest } from './pet-motion-clip.js';
import { isPetPlayerNavigationAllowed, isPetPlayerRequestAllowed } from './pet-player-policy.js';
import { createPetMediaWorkerWebPreferences } from './pet-media-worker-policy.js';

const DEFAULT_TIMEOUT_MS = 90_000;
type WorkerTerminalMessage = Exclude<PetMediaWorkerOutputMessage, { readonly kind: 'hello' }>;

export class ChromiumPetMotionRasterizer implements PetMotionClipRasterizer, PetAtlasFrameDecoder {
  readonly id = 'chromium-media-worker';
  readonly version: string;
  readonly #entryUrl: string;
  readonly #preloadPath: string;
  readonly #timeoutMs: number;
  #nextGeneration = 0;

  constructor(options: Readonly<{ entryUrl: string; preloadPath: string; timeoutMs?: number; chromiumVersion?: string }>) {
    if (!validEntryUrl(options.entryUrl) || options.preloadPath.trim() === '') throw new Error('invalid pet media worker configuration');
    if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 300_000)) {
      throw new Error('invalid pet media worker timeout');
    }
    const chromiumVersion = options.chromiumVersion ?? process.versions.chrome;
    if (chromiumVersion === undefined || !/^[0-9]+(?:\.[0-9]+){1,3}$/.test(chromiumVersion)) throw new Error('invalid Chromium version');
    this.version = `chromium-${chromiumVersion}`;
    this.#entryUrl = options.entryUrl;
    this.#preloadPath = options.preloadPath;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  rasterize(request: PetMotionClipRasterizerRequest): Promise<PetMotionClipRasterization> {
    return this.#runJob(
      request.signal,
      ({ realmEpoch, jobGeneration }) => ({
        kind: 'rasterize', realmEpoch, jobGeneration,
        clipBytes: ownedArrayBuffer(request.clip.bytes), spec: request.spec,
      }),
      (message) => {
        if (message.kind !== 'result') throw new PetVisualGenerationError('invalid-output', 'unexpected pet media worker result');
        return { atlas: { ...message.atlas, bytes: new Uint8Array(message.atlasBytes) }, evidence: message.evidence };
      },
    );
  }

  decode(atlas: GeneratedMotionAtlas, signal: AbortSignal): Promise<DecodedPetAtlas> {
    return this.#runJob(
      signal,
      ({ realmEpoch, jobGeneration }) => ({
        kind: 'decode-atlas', realmEpoch, jobGeneration,
        atlasBytes: ownedArrayBuffer(atlas.bytes),
        atlas: {
          motion: atlas.motion, mediaType: atlas.mediaType, width: atlas.width, height: atlas.height,
          columns: atlas.columns, rows: atlas.rows, frameCount: atlas.frameCount, durationMs: atlas.durationMs,
        },
      }),
      (message) => decodedPetAtlasFromWorkerMessage(message, atlas),
    );
  }

  #runJob<T>(
    signal: AbortSignal,
    createJob: (context: Readonly<{ realmEpoch: string; jobGeneration: number }>) => PetMediaWorkerHostMessage,
    mapResult: (message: WorkerTerminalMessage) => T,
  ): Promise<T> {
    if (signal.aborted) return Promise.reject(new Error('aborted'));
    const jobGeneration = this.#nextGeneration++;
    const realmEpoch = randomBytes(16).toString('hex');
    const nonce = randomBytes(16).toString('hex');
    const partition = `dsh-pet-media-${randomBytes(16).toString('hex')}`;
    const worker = new BrowserWindow({
      show: false, width: 16, height: 16, frame: false, transparent: true,
      webPreferences: createPetMediaWorkerWebPreferences(this.#preloadPath, partition),
    });
    const workerSession = worker.webContents.session;
    let port: MessagePortMain | undefined;
    let helloReceived = false;
    let settled = false;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => fail(new PetVisualGenerationError('transient', 'pet media worker timed out')), this.#timeoutMs);
      const onAbort = (): void => fail(new Error('aborted'));
      const denyDownload = (event: Electron.Event): void => event.preventDefault();
      const denyNavigation = (event: Electron.Event, target: string): void => {
        if (!isPetPlayerNavigationAllowed(this.#entryUrl, target) || helloReceived) {
          event.preventDefault();
          fail(new PetVisualGenerationError('invalid-output', 'pet media worker navigated'));
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
      worker.webContents.on('will-navigate', denyNavigation);
      worker.webContents.on('render-process-gone', (_event, details) => {
        fail(new PetVisualGenerationError('transient', `pet media worker exited: ${details.reason}`));
      });
      worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      workerSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      workerSession.setPermissionCheckHandler(() => false);
      workerSession.on('will-download', denyDownload);
      workerSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
        callback({ cancel: !isPetPlayerRequestAllowed(this.#entryUrl, details.url) });
      });

      void worker.loadURL(this.#entryUrl).then(() => {
        if (settled) return;
        const channel = new MessageChannelMain();
        port = channel.port1;
        channel.port1.on('message', ({ data }) => {
          const payload = unwrapSingleMessage(data);
          const message = parsePetMediaWorkerOutputMessage(payload, { realmEpoch, nonce, jobGeneration });
          if (message === undefined) {
            fail(new PetVisualGenerationError('invalid-output', `invalid pet media worker message: ${messageShape(payload, realmEpoch, jobGeneration)}`));
            return;
          }
          if (message.kind === 'hello') {
            if (helloReceived) {
              fail(new PetVisualGenerationError('invalid-output', 'duplicate pet media worker handshake'));
              return;
            }
            helloReceived = true;
            channel.port1.postMessage(createJob({ realmEpoch, jobGeneration }));
            return;
          }
          if (!helloReceived) {
            fail(new PetVisualGenerationError('invalid-output', 'pet media worker result before handshake'));
            return;
          }
          if (message.kind === 'failure') {
            fail(message.code === 'aborted' ? new Error('aborted') : new PetVisualGenerationError('invalid-output', `pet media worker failed: ${message.code}`));
            return;
          }
          try {
            finish(mapResult(message));
          } catch (error) {
            fail(error instanceof Error ? error : new PetVisualGenerationError('invalid-output', 'invalid pet media worker result'));
          }
        });
        channel.port1.on('close', () => {
          if (!settled) fail(new PetVisualGenerationError('transient', 'pet media worker port closed'));
        });
        channel.port1.start();
        worker.webContents.mainFrame.postMessage(PET_MEDIA_WORKER_INIT_CHANNEL, {
          protocolVersion: PET_MEDIA_WORKER_PROTOCOL_VERSION, realmEpoch, nonce,
        }, [channel.port2]);
      }).catch(() => fail(new PetVisualGenerationError('transient', 'pet media worker failed to load')));

      function finish(result: T): void {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      }
      function fail(error: Error): void {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      }
      function cleanup(): void {
        clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
        port?.postMessage({ kind: 'dispose', realmEpoch } satisfies PetMediaWorkerHostMessage);
        port?.close();
        workerSession.removeListener('will-download', denyDownload);
        workerSession.setPermissionRequestHandler(null);
        workerSession.setPermissionCheckHandler(null);
        workerSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, null);
        if (!worker.isDestroyed()) worker.destroy();
      }
    });
  }
}

export function decodedPetAtlasFromWorkerMessage(
  message: WorkerTerminalMessage,
  expected: Pick<GeneratedMotionAtlas, 'frameCount'>,
): DecodedPetAtlas {
  if (message.kind !== 'decoded-atlas'
    || message.frameCount !== expected.frameCount
    || message.framesBytes.byteLength !== message.frameCount * PET_MEDIA_WORKER_FRAME_BYTES) {
    throw new PetVisualGenerationError('invalid-output', 'unexpected decoded pet atlas result');
  }
  const combined = new Uint8ClampedArray(message.framesBytes);
  const frames = Array.from({ length: message.frameCount }, (_, index) => {
    const start = index * PET_MEDIA_WORKER_FRAME_BYTES;
    return new Uint8ClampedArray(combined.slice(start, start + PET_MEDIA_WORKER_FRAME_BYTES));
  });
  return { cellWidth: message.cellWidth, cellHeight: message.cellHeight, frames };
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new Uint8Array(bytes.byteLength);
  output.set(bytes);
  return output.buffer;
}

function validEntryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'file:' || ((url.protocol === 'http:' || url.protocol === 'https:')
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'));
  } catch {
    return false;
  }
}

function messageShape(value: unknown, realmEpoch: string, jobGeneration: number): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return JSON.stringify({ type: typeof value, arrayLength: Array.isArray(value) ? value.length : undefined });
  const record = value as Readonly<Record<string, unknown>>;
  const binary = record.atlasBytes ?? record.framesBytes;
  return JSON.stringify({
    kind: record.kind, keys: Object.keys(record).sort(), epochMatches: record.realmEpoch === realmEpoch,
    generationMatches: record.jobGeneration === jobGeneration, binaryType: binary?.constructor?.name,
    binaryByteLength: typeof binary === 'object' && binary !== null && 'byteLength' in binary
      ? (binary as { readonly byteLength?: unknown }).byteLength : undefined,
  });
}

function unwrapSingleMessage(value: unknown): unknown {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}
