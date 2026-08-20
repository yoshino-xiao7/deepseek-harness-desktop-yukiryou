import { PET_MOTIONS, PET_PACKAGE_LIMITS, type PetMotion } from '../../shared/pet-package.js';
import type { PetAuthoringAdapterReport } from '../../shared/pet-authoring.js';
import type {
  PetAuthoringAdapter,
  PetAuthoringAdapterOutput,
  PetAuthoringAdapterRequest,
} from './pet-authoring-workflow.js';
import {
  buildStoredZip,
  canonicalPetPackageJson as canonicalJson,
  hashPetPackageBytes as sha256,
  type StoredZipEntry,
} from './pet-package-builder.js';
import { isValidPetThumbnail, petRasterDimensions, type PetThumbnailMediaType } from './pet-thumbnail-validation.js';

export interface GeneratedMotionAtlas {
  readonly motion: PetMotion;
  readonly mediaType: 'image/png' | 'image/webp';
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
  readonly frameCount: number;
  readonly durationMs: number;
}

export interface FrameSequenceGeneration {
  readonly generator: Readonly<{ id: string; version: string }>;
  readonly thumbnail: {
    readonly mediaType: PetThumbnailMediaType;
    readonly bytes: Uint8Array;
  };
  readonly atlases: readonly GeneratedMotionAtlas[];
}

export interface FrameSequenceGeneratorRequest extends Omit<PetAuthoringAdapterRequest, 'progress'> {
  readonly progress: Pick<PetAuthoringAdapterRequest['progress'], 'mainLookReady' | 'motionReady'>;
}

export interface FrameSequenceGenerator {
  readonly extraProviderCredentialRequired: boolean;
  generate(request: FrameSequenceGeneratorRequest): Promise<FrameSequenceGeneration>;
}

export interface FrameSequenceVisualQaRequest extends Omit<PetAuthoringAdapterRequest, 'progress'> {
  readonly generation: FrameSequenceGeneration;
  readonly generationSha256: string;
}

export interface FrameSequenceVisualQaResult {
  readonly creatorInputSha256: string;
  readonly generationSha256: string;
  readonly evaluator: Readonly<{ id: string; version: string }>;
  readonly qa: PetAuthoringAdapterReport['qa'];
}

export interface FrameSequenceVisualQa {
  readonly extraProviderCredentialRequired: boolean;
  evaluate(request: FrameSequenceVisualQaRequest): Promise<FrameSequenceVisualQaResult>;
}

export interface FrameSequencePackageMetadata {
  readonly id: string;
  readonly author: string;
  readonly license: string;
  readonly source: string;
  readonly englishName?: string;
}

export interface FrameSequencePetPackageRequest {
  readonly displayName: string;
  readonly thumbnail: FrameSequenceGeneration['thumbnail'];
  readonly atlases: readonly GeneratedMotionAtlas[];
  readonly metadata: FrameSequencePackageMetadata;
}

/**
 * Builds the declarative package shared by the authoring workflow and the
 * explicitly labelled built-in development preview. Creator-gate evidence is
 * deliberately kept outside this function: callers may build a preview, but
 * only PetAuthoringWorkflow can publish an importable user asset as accepted.
 */
export function buildFrameSequencePetPackage(request: FrameSequencePetPackageRequest): Uint8Array {
  const thumbnailBytes = Buffer.from(request.thumbnail.bytes);
  if (!isValidPetThumbnail(thumbnailBytes, request.thumbnail.mediaType)) throw new Error('invalid thumbnail');
  const atlases = validateAtlases(request.atlases);
  const thumbnailPath = request.thumbnail.mediaType === 'image/png' ? 'thumbnail.png' : 'thumbnail.webp';
  const timeline = {
    schemaVersion: 1,
    renderer: 'canvas2d',
    motions: Object.fromEntries(atlases.map((atlas) => [atlas.motion, {
      path: atlas.path,
      width: atlas.width,
      height: atlas.height,
      columns: atlas.columns,
      rows: atlas.rows,
      frameCount: atlas.frameCount,
      durationMs: atlas.durationMs,
    }])),
  };
  const payloadEntries: StoredZipEntry[] = [
    { path: thumbnailPath, bytes: thumbnailBytes },
    { path: 'payload/timeline.json', bytes: Buffer.from(JSON.stringify(timeline)) },
    ...atlases.map((atlas) => ({ path: atlas.path, bytes: atlas.bytes })),
  ].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const files = payloadEntries.map((entry) => ({
    path: entry.path,
    role: entry.path === thumbnailPath ? 'thumbnail' : 'animation',
    mediaType: mediaTypeForPath(entry.path),
    byteLength: entry.bytes.byteLength,
    sha256: sha256(entry.bytes),
  }));
  const manifestWithoutHash = {
    schemaVersion: 0,
    id: request.metadata.id,
    name: { 'zh-CN': request.displayName, en: request.metadata.englishName ?? request.displayName },
    author: request.metadata.author,
    license: request.metadata.license,
    source: request.metadata.source,
    runtime: {
      adapter: 'frame-sequence-canvas2d',
      adapterContractVersion: 1,
      assetFormat: { family: 'frame-sequence-atlas', major: 1 },
    },
    viewport: { width: 1024, height: 640, baseline: 600 },
    motions: Object.fromEntries(PET_MOTIONS.map((motion) => [motion, {}])),
    files,
  };
  const manifest = {
    ...manifestWithoutHash,
    packageContentHash: sha256(Buffer.from(canonicalJson(manifestWithoutHash))),
  };
  return buildStoredZip([
    { path: 'pet.json', bytes: Buffer.from(JSON.stringify(manifest)) },
    ...payloadEntries,
  ]);
}

export class FrameSequenceAuthoringAdapter implements PetAuthoringAdapter {
  readonly candidateId = 'frame-sequence-canvas2d' as const;

  constructor(
    private readonly generator: FrameSequenceGenerator,
    private readonly visualQa: FrameSequenceVisualQa,
    private readonly metadata: FrameSequencePackageMetadata,
  ) {}

  async author(request: PetAuthoringAdapterRequest): Promise<PetAuthoringAdapterOutput> {
    const generated = await this.generator.generate({
      input: cloneCreatorInput(request.input),
      creatorInputSha256: request.creatorInputSha256,
      references: cloneReferences(request.references),
      signal: request.signal,
      progress: {
        mainLookReady: () => request.progress.mainLookReady(),
        motionReady: (motion) => request.progress.motionReady(motion),
      },
    });
    if (request.signal.aborted) throw new Error('aborted');
    const thumbnailBytes = Buffer.from(generated.thumbnail.bytes);
    if (!isValidPetThumbnail(thumbnailBytes, generated.thumbnail.mediaType)) throw new Error('invalid thumbnail');
    if (!safeAdapterIdentifier(generated.generator.id) || !safeAdapterIdentifier(generated.generator.version)) {
      throw new Error('invalid generator identity');
    }
    const atlases = validateAtlases(generated.atlases);
    request.progress.mainLookReady();
    for (const atlas of atlases) request.progress.motionReady(atlas.motion);
    const generationSha256 = fingerprintGeneration(generated.generator, generated.thumbnail.mediaType, thumbnailBytes, atlases);
    request.progress.visualQaStarted();
    const qaEvidence = await this.visualQa.evaluate({
      input: cloneCreatorInput(request.input),
      creatorInputSha256: request.creatorInputSha256,
      references: cloneReferences(request.references),
      signal: request.signal,
      generation: cloneGeneration(generated.generator, generated.thumbnail.mediaType, thumbnailBytes, atlases),
      generationSha256,
    });
    if (request.signal.aborted) throw new Error('aborted');
    if (
      qaEvidence.creatorInputSha256 !== request.creatorInputSha256
      || qaEvidence.generationSha256 !== generationSha256
      || !safeAdapterIdentifier(qaEvidence.evaluator.id)
      || !safeAdapterIdentifier(qaEvidence.evaluator.version)
    ) throw new Error('unbound visual QA evidence');
    const archive = buildFrameSequencePetPackage({
      displayName: request.input.displayName,
      thumbnail: { mediaType: generated.thumbnail.mediaType, bytes: thumbnailBytes },
      atlases,
      metadata: this.metadata,
    });
    return {
      archive,
      report: {
        automation: {
          userProvidedEngineAsset: false,
          proprietaryEditorRequired: false,
          manualEditorSteps: 0,
          extraProviderCredentialRequired:
            this.generator.extraProviderCredentialRequired || this.visualQa.extraProviderCredentialRequired,
        },
        motions: Object.fromEntries(atlases.map((atlas) => [atlas.motion, {
          generated: true,
          durationMs: atlas.durationMs,
          frameCount: atlas.frameCount,
        }])) as PetAuthoringAdapterReport['motions'],
        qa: qaEvidence.qa,
      },
    };
  }
}

interface ValidatedAtlas extends GeneratedMotionAtlas {
  readonly path: string;
  readonly bytes: Uint8Array;
}

function validateAtlases(input: readonly GeneratedMotionAtlas[]): readonly ValidatedAtlas[] {
  if (input.length !== PET_MOTIONS.length) throw new Error('incomplete motion atlases');
  const byMotion = new Map<PetMotion, GeneratedMotionAtlas>();
  for (const atlas of input) {
    if (!PET_MOTIONS.includes(atlas.motion) || byMotion.has(atlas.motion)) throw new Error('duplicate motion atlas');
    if (!(atlas.bytes instanceof Uint8Array) || atlas.bytes.byteLength < 1 || atlas.bytes.byteLength > PET_PACKAGE_LIMITS.entryBytes) {
      throw new Error('invalid motion atlas bytes');
    }
    const dimensions = petRasterDimensions(Buffer.from(atlas.bytes), atlas.mediaType);
    if (dimensions?.width !== atlas.width || dimensions.height !== atlas.height) throw new Error('motion atlas dimensions mismatch');
    if (!positiveInteger(atlas.columns) || !positiveInteger(atlas.rows) || !positiveInteger(atlas.frameCount)) throw new Error('invalid motion atlas grid');
    if (atlas.columns * atlas.rows < atlas.frameCount || atlas.frameCount < 2 || atlas.frameCount > 3_600) throw new Error('invalid motion frame count');
    if (!positiveInteger(atlas.durationMs) || atlas.durationMs < 100 || atlas.durationMs > 60_000) throw new Error('invalid motion duration');
    byMotion.set(atlas.motion, atlas);
  }
  return PET_MOTIONS.map((motion) => {
    const atlas = byMotion.get(motion)!;
    const extension = atlas.mediaType === 'image/png' ? 'png' : 'webp';
    return { ...atlas, bytes: Uint8Array.from(atlas.bytes), path: `payload/${motion}.${extension}` };
  });
}

function mediaTypeForPath(path: string): string {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'application/json';
}

function cloneGeneration(
  generator: FrameSequenceGeneration['generator'],
  thumbnailMediaType: PetThumbnailMediaType,
  thumbnailBytes: Uint8Array,
  atlases: readonly ValidatedAtlas[],
): FrameSequenceGeneration {
  return {
    generator: { ...generator },
    thumbnail: { mediaType: thumbnailMediaType, bytes: Uint8Array.from(thumbnailBytes) },
    atlases: atlases.map((atlas) => ({
      motion: atlas.motion,
      mediaType: atlas.mediaType,
      bytes: Uint8Array.from(atlas.bytes),
      width: atlas.width,
      height: atlas.height,
      columns: atlas.columns,
      rows: atlas.rows,
      frameCount: atlas.frameCount,
      durationMs: atlas.durationMs,
    })),
  };
}

function cloneCreatorInput(input: PetAuthoringAdapterRequest['input']): PetAuthoringAdapterRequest['input'] {
  return {
    ...input,
    references: input.references.map((reference) => ({ ...reference })),
  };
}

function cloneReferences(references: ReadonlyMap<string, Uint8Array>): ReadonlyMap<string, Uint8Array> {
  return new Map([...references].map(([id, bytes]) => [id, Uint8Array.from(bytes)]));
}

function fingerprintGeneration(
  generator: FrameSequenceGeneration['generator'],
  thumbnailMediaType: PetThumbnailMediaType,
  thumbnailBytes: Uint8Array,
  atlases: readonly ValidatedAtlas[],
): string {
  return sha256(Buffer.from(canonicalJson({
    generator,
    thumbnail: { mediaType: thumbnailMediaType, byteLength: thumbnailBytes.byteLength, sha256: sha256(thumbnailBytes) },
    atlases: atlases.map((atlas) => ({
      motion: atlas.motion,
      mediaType: atlas.mediaType,
      byteLength: atlas.bytes.byteLength,
      sha256: sha256(atlas.bytes),
      width: atlas.width,
      height: atlas.height,
      columns: atlas.columns,
      rows: atlas.rows,
      frameCount: atlas.frameCount,
      durationMs: atlas.durationMs,
    })),
  })));
}

function safeAdapterIdentifier(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value);
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
