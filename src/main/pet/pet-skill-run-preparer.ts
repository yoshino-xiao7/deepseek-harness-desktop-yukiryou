import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

import {
  PET_CREATOR_INPUT_SCHEMA_VERSION,
  validatePetCreatorInput,
  type PetCreatorInput,
} from '../../shared/pet-authoring.js';
import { PET_MOTIONS, type PetMotion } from '../../shared/pet-package.js';
import { PET_MOTION_GENERATION_SPECS } from './frame-sequence-generation-orchestrator.js';
import { petRasterDimensions } from './pet-thumbnail-validation.js';

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 64 * 1024 * 1024;

export interface PetSkillRunSourceReference {
  readonly id: string;
  readonly role: 'primary' | 'supplemental';
  readonly path: string;
}

export interface PetSkillRunRequest {
  readonly schemaVersion: 1;
  readonly locale: 'zh-CN' | 'en';
  readonly displayName: string;
  readonly request: string;
  readonly references: readonly PetSkillRunSourceReference[];
}

export interface PreparedPetSkillRun {
  readonly rootDirectory: string;
  readonly creatorInput: PetCreatorInput;
  readonly jobs: readonly PetSkillJob[];
}

export interface PetSkillJob {
  readonly id: 'canonical-look' | PetMotion;
  readonly kind: 'canonical-look' | 'motion-family';
  readonly status: 'pending';
  readonly dependsOn: readonly string[];
  readonly promptPath: string;
  readonly outputPath: string;
}

interface PreparedReference {
  readonly source: PetSkillRunSourceReference;
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly extension: 'png' | 'jpg' | 'webp';
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

export async function preparePetSkillRun(
  request: PetSkillRunRequest,
  outputDirectory: string,
): Promise<PreparedPetSkillRun> {
  if (request.schemaVersion !== 1 || !Array.isArray(request.references)) throw new Error('invalid skill run request');
  const preparedReferences = await Promise.all(request.references.map(prepareReference));
  const totalBytes = preparedReferences.reduce((sum, reference) => sum + reference.bytes.byteLength, 0);
  if (totalBytes > MAX_TOTAL_REFERENCE_BYTES) throw new Error('pet references exceed total byte limit');
  const creatorInput = createCreatorInput(request, preparedReferences);
  const validation = validatePetCreatorInput(creatorInput);
  if (validation.status === 'rejected') throw new Error(`invalid Creator Input: ${validation.issues.join(', ')}`);
  const jobs = createJobs();

  await mkdir(dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory);
  await Promise.all([
    mkdir(join(outputDirectory, 'references')),
    mkdir(join(outputDirectory, 'prompts')),
    mkdir(join(outputDirectory, 'generated')),
    mkdir(join(outputDirectory, 'qa')),
    mkdir(join(outputDirectory, 'final')),
  ]);
  await Promise.all([
    mkdir(join(outputDirectory, 'generated', 'keyframes')),
    mkdir(join(outputDirectory, 'generated', 'frames')),
    mkdir(join(outputDirectory, 'generated', 'atlases')),
  ]);
  await Promise.all(PET_MOTIONS.map((motion) => mkdir(
    join(outputDirectory, 'generated', 'keyframes', motion),
  )));
  await Promise.all(preparedReferences.map((reference) => writeFile(
    join(outputDirectory, 'references', `${reference.source.id}.${reference.extension}`),
    reference.bytes,
    { flag: 'wx' },
  )));
  await Promise.all([
    writeJson(join(outputDirectory, 'creator-input.json'), validation.input),
    writeJson(join(outputDirectory, 'authoring-jobs.json'), { schemaVersion: 1, jobs }),
    writeJson(join(outputDirectory, 'progress.json'), {
      schemaVersion: 1,
      stage: 'preparing',
      status: 'ready',
      completedMotions: [],
    }),
    writeFile(join(outputDirectory, 'prompts', 'canonical-look.md'), canonicalLookPrompt(validation.input), { flag: 'wx' }),
    ...PET_MOTIONS.map((motion) => writeFile(
      join(outputDirectory, 'prompts', `${motion}.md`),
      motionPrompt(validation.input, motion),
      { flag: 'wx' },
    )),
  ]);
  return { rootDirectory: outputDirectory, creatorInput: validation.input, jobs };
}

async function prepareReference(source: PetSkillRunSourceReference): Promise<PreparedReference> {
  const bytes = await readFile(source.path);
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_REFERENCE_BYTES) throw new Error(`invalid reference size: ${source.id}`);
  const detected = detectImage(bytes, extname(source.path).toLowerCase());
  if (detected === undefined) throw new Error(`unsupported or corrupt reference: ${basename(source.path)}`);
  return {
    source,
    ...detected,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function createCreatorInput(
  request: PetSkillRunRequest,
  references: readonly PreparedReference[],
): PetCreatorInput {
  return {
    schemaVersion: PET_CREATOR_INPUT_SCHEMA_VERSION,
    locale: request.locale,
    displayName: request.displayName,
    request: request.request,
    references: references.map((reference) => ({
      id: reference.source.id,
      role: reference.source.role,
      mediaType: reference.mediaType,
      byteLength: reference.bytes.byteLength,
      width: reference.width,
      height: reference.height,
      sha256: reference.sha256,
    })),
  };
}

function createJobs(): PetSkillJob[] {
  return [
    {
      id: 'canonical-look',
      kind: 'canonical-look',
      status: 'pending',
      dependsOn: [],
      promptPath: 'prompts/canonical-look.md',
      outputPath: 'generated/canonical-look.png',
    },
    ...PET_MOTIONS.map((motion) => ({
      id: motion,
      kind: 'motion-family' as const,
      status: 'pending' as const,
      dependsOn: motionDependencies(motion),
      promptPath: `prompts/${motion}.md`,
      outputPath: `generated/keyframes/${motion}`,
    })),
  ];
}

function motionDependencies(motion: PetMotion): readonly string[] {
  const previous: Partial<Record<PetMotion, PetMotion>> = {
    drowsy: 'standing',
    'lying-down': 'drowsy',
    sleeping: 'lying-down',
    waking: 'sleeping',
    'rubbing-eyes': 'waking',
    'work-enter': 'standing',
    eating: 'work-enter',
    'work-exit': 'eating',
  };
  return ['canonical-look', ...(previous[motion] === undefined ? [] : [previous[motion]])];
}

function canonicalLookPrompt(input: PetCreatorInput): string {
  return [
    `Create the canonical full-body look for ${input.displayName}.`,
    `Creator request: ${input.request}`,
    'Preserve the authoritative reference identity, face, proportions, clothing, palette, hair, tail, and props.',
    'Use one centered complete character on a clean removable chroma background. No text, scenery, shadow, glow, or detached effects.',
    'This image is identity evidence for all later motion families; do not redesign the character.',
  ].join('\n\n');
}

function motionPrompt(input: PetCreatorInput, motion: PetMotion): string {
  const spec = PET_MOTION_GENERATION_SPECS[motion];
  return [
    `Create one coherent ${motion} motion family for ${input.displayName}.`,
    `Creator request: ${input.request}`,
    `Motion requirement: ${spec.instruction}`,
    `Target timeline: ${spec.durationMs}ms at ${spec.fps}fps (${spec.frameCount} final frames); loop=${String(spec.loop)}.`,
    'Use the canonical-look image and every listed dependency as authoritative grounding.',
    'Produce semantic pose evidence only. The dense-motion synthesis Module owns final interpolation and registration.',
    'Preserve anatomy and identity. Keep the activity baseline stable and every pose inside the safe area.',
    'No text, speech bubble, scenery, shadow, glow, motion trail, detached effect, or visible guide.',
  ].join('\n\n');
}

function detectImage(
  bytes: Buffer,
  extension: string,
): Omit<PreparedReference, 'source' | 'bytes' | 'sha256'> | undefined {
  const png = petRasterDimensions(bytes, 'image/png');
  if (png !== undefined) return { mediaType: 'image/png', extension: 'png', ...png };
  const webp = petRasterDimensions(bytes, 'image/webp');
  if (webp !== undefined) return { mediaType: 'image/webp', extension: 'webp', ...webp };
  const jpeg = jpegDimensions(bytes);
  if (jpeg !== undefined && (extension === '.jpg' || extension === '.jpeg')) {
    return { mediaType: 'image/jpeg', extension: 'jpg', ...jpeg };
  }
  return undefined;
}

function jpegDimensions(bytes: Buffer): { readonly width: number; readonly height: number } | undefined {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 8 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1]!;
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) return undefined;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.byteLength) return undefined;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    offset += length;
  }
  return undefined;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}
