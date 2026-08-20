import { PetVisualGenerationError, type PetMotionGenerationSpec } from './frame-sequence-generation-orchestrator.js';
import type {
  PetGeneratedMotionClip,
  PetMotionClipAdapter,
  PetMotionClipRequest,
} from './pet-motion-clip.js';

const RUNWAY_API_BASE = 'https://api.dev.runwayml.com/v1';
const RUNWAY_API_VERSION = '2024-11-06';
const RUNWAY_MODEL = 'gen4.5';
const RUNWAY_RATIO = '960:960';
const MAX_INPUT_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_VIDEO_BYTES = 64 * 1024 * 1024;
const MAX_POLLS = 120;
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RunwayPetVideoAdapterOptions {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export class RunwayPetVideoAdapter implements PetMotionClipAdapter {
  readonly id = 'runway-gen4.5';
  readonly version = `${RUNWAY_API_VERSION}.1`;
  readonly extraProviderCredentialRequired = true;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;

  constructor(options: RunwayPetVideoAdapterOptions) {
    if (options.apiKey.trim().length < 8 || /\s/.test(options.apiKey)) throw new Error('invalid Runway API key');
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? fetch;
    this.#wait = options.wait ?? abortableWait;
  }

  async generate(request: PetMotionClipRequest): Promise<PetGeneratedMotionClip> {
    validateRequest(request);
    const sourceSeconds = Math.max(2, Math.min(10, Math.ceil(request.spec.durationMs / 1_000)));
    let taskId: string | undefined;
    try {
      taskId = await this.#createTask(request, sourceSeconds);
      const outputUrl = await this.#waitForTask(taskId, request.signal);
      const bytes = await this.#download(outputUrl, request.signal);
      return { mediaType: 'video/mp4', bytes, sourceDurationMs: sourceSeconds * 1_000 };
    } finally {
      if (taskId !== undefined) await this.#deleteTask(taskId);
    }
  }

  async #createTask(request: PetMotionClipRequest, sourceSeconds: number): Promise<string> {
    const promptImage = `data:${request.canonicalLook.mediaType};base64,${Buffer.from(request.canonicalLook.bytes).toString('base64')}`;
    const response = await this.#request(`${RUNWAY_API_BASE}/image_to_video`, {
      method: 'POST',
      headers: this.#headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        model: RUNWAY_MODEL,
        promptImage,
        promptText: compilePrompt(request.inputRequest, request.spec),
        ratio: RUNWAY_RATIO,
        duration: sourceSeconds,
      }),
      signal: request.signal,
    });
    const body = await parseJson(response);
    if (!isRecord(body) || typeof body.id !== 'string' || !TASK_ID.test(body.id)) {
      throw new PetVisualGenerationError('invalid-output', 'Runway returned an invalid task id');
    }
    return body.id;
  }

  async #waitForTask(taskId: string, signal: AbortSignal): Promise<string> {
    for (let poll = 0; poll < MAX_POLLS; poll += 1) {
      throwIfAborted(signal);
      const response = await this.#request(`${RUNWAY_API_BASE}/tasks/${taskId}`, {
        method: 'GET',
        headers: this.#headers(),
        signal,
      });
      const body = await parseJson(response);
      if (!isRecord(body) || typeof body.status !== 'string') {
        throw new PetVisualGenerationError('invalid-output', 'Runway returned an invalid task');
      }
      if (body.status === 'SUCCEEDED') return outputUrl(body);
      if (body.status === 'FAILED') {
        const code = typeof body.failureCode === 'string' ? body.failureCode : '';
        throw new PetVisualGenerationError(code.startsWith('SAFETY.') ? 'policy-rejected' : 'invalid-output', 'Runway task failed');
      }
      if (body.status === 'CANCELED') throw new PetVisualGenerationError('invalid-output', 'Runway task was canceled');
      if (!['PENDING', 'RUNNING', 'THROTTLED'].includes(body.status)) {
        throw new PetVisualGenerationError('invalid-output', 'Runway returned an unknown task status');
      }
      await this.#wait(5_000, signal);
    }
    throw new PetVisualGenerationError('transient', 'Runway task timed out');
  }

  async #download(value: string, signal: AbortSignal): Promise<Uint8Array> {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
      throw new PetVisualGenerationError('invalid-output', 'Runway returned an unsafe output URL');
    }
    const response = await this.#fetch(url, { method: 'GET', redirect: 'error', signal });
    if (!response.ok) throw httpError(response.status);
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
    if (contentType !== 'video/mp4') throw new PetVisualGenerationError('invalid-output', 'Runway output is not MP4');
    return readBoundedBody(response, MAX_OUTPUT_VIDEO_BYTES);
  }

  async #deleteTask(taskId: string): Promise<void> {
    try {
      await this.#fetch(`${RUNWAY_API_BASE}/tasks/${taskId}`, {
        method: 'DELETE',
        headers: this.#headers(),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // Best-effort remote cleanup must not replace the primary result or error.
    }
  }

  async #request(input: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(input, { ...init, redirect: 'error' });
    } catch (error) {
      if (init.signal?.aborted) throw abortError();
      throw new PetVisualGenerationError('transient', error instanceof Error ? error.message : 'Runway transport failed');
    }
    if (!response.ok) throw httpError(response.status);
    return response;
  }

  #headers(extra: Readonly<Record<string, string>> = {}): Headers {
    return new Headers({
      Authorization: `Bearer ${this.#apiKey}`,
      'X-Runway-Version': RUNWAY_API_VERSION,
      ...extra,
    });
  }
}

function validateRequest(request: PetMotionClipRequest): void {
  throwIfAborted(request.signal);
  if (request.canonicalLook.role !== 'canonical-look') throw new PetVisualGenerationError('invalid-request', 'missing canonical look');
  if (request.canonicalLook.mediaType !== 'image/png' && request.canonicalLook.mediaType !== 'image/webp') {
    throw new PetVisualGenerationError('invalid-request', 'unsupported canonical look format');
  }
  if (request.canonicalLook.bytes.byteLength < 1 || request.canonicalLook.bytes.byteLength > MAX_INPUT_IMAGE_BYTES) {
    throw new PetVisualGenerationError('invalid-request', 'canonical look size');
  }
}

function compilePrompt(inputRequest: string, spec: PetMotionGenerationSpec): string {
  const constraints = [
    'One full-body pet, centered and fully visible, fixed camera, square frame.',
    'Preserve exactly the reference character identity, face, proportions, palette, clothing, hair, tail and props.',
    spec.instruction,
    spec.loop ? 'The first and last pose must form a seamless loop.' : 'Use one continuous transition with no cut.',
    'Flat saturated green background, no floor, shadow, scenery, text, symbols, particles, detached effects or camera motion.',
    `User direction: ${inputRequest}`,
  ].join(' ');
  return constraints.length <= 1_000 ? constraints : constraints.slice(0, 1_000);
}

function outputUrl(body: Readonly<Record<string, unknown>>): string {
  if (!Array.isArray(body.output) || body.output.length !== 1 || typeof body.output[0] !== 'string') {
    throw new PetVisualGenerationError('invalid-output', 'Runway task has no unique output');
  }
  return body.output[0];
}

async function parseJson(response: Response): Promise<unknown> {
  const bytes = await readBoundedBody(response, 256 * 1024);
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    throw new PetVisualGenerationError('invalid-output', 'Runway returned invalid JSON');
  }
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new PetVisualGenerationError('invalid-output', 'Runway response exceeds byte limit');
  }
  if (response.body === null) throw new PetVisualGenerationError('invalid-output', 'Runway response body is missing');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      throw new PetVisualGenerationError('invalid-output', 'Runway response exceeds byte limit');
    }
    chunks.push(value);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function httpError(status: number): PetVisualGenerationError {
  return new PetVisualGenerationError(status === 429 || status >= 500 ? 'transient' : 'invalid-request', `Runway HTTP ${status}`);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function abortError(): Error {
  return new Error('aborted');
}

function abortableWait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(abortError());
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
